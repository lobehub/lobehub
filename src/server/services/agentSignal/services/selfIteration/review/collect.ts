import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import type { AgentSignalDocumentActivityRow } from '@/database/models/agentSignal/reviewContext';

import type { ActionType, EvidenceRef, SelfFeedbackIntent } from '../types';
import type { RankedSelfFeedbackCandidate } from './intentPolicy';
import {
  groupSelfFeedbackIntents,
  normalizeReflectionIntent,
  rankSelfFeedbackCandidates,
} from './intentPolicy';
import type { SelfReviewProposalStatus } from './proposal';
import { deriveSelfReviewSignals } from './signals';

const DEFAULT_MAX_TOPICS = 30;
const DEFAULT_MAX_MANAGED_SKILLS = 20;
const DEFAULT_MAX_RELEVANT_MEMORIES = 20;

const HIGH_SIGNAL_REASON_ORDER = [
  'failure',
  'negative_feedback',
  'correction',
  'failed_tool',
  'receipt',
] as const;

const HIGH_SIGNAL_SCORE_WEIGHTS = {
  correction: 3000,
  failed_tool: 4000,
  failure: 4500,
  negative_feedback: 5000,
  receipt: 1500,
} as const satisfies Record<NightlyReviewHighSignalReason, number>;

const RAW_ATTRIBUTE_KEYS = new Set([
  'messages',
  'rawmessages',
  'rawtranscript',
  'rawtranscripts',
  'transcript',
  'transcripts',
]);

/** High-signal reason labels emitted for nightly topic ranking. */
export type NightlyReviewHighSignalReason = (typeof HIGH_SIGNAL_REASON_ORDER)[number];

/**
 * Input shared by nightly review collector read adapters.
 *
 * Use when:
 * - Digest data sources need the same user-agent review window
 * - Tests need to assert simple read inputs without DB coupling
 *
 * Expects:
 * - Review windows are ISO strings from the source event payload
 *
 * Returns:
 * - A bounded read request for one nightly review collection pass
 */
export interface NightlyReviewReadInput {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Maximum summaries to return from the read adapter. */
  limit?: number;
  /** Review window end as an ISO string. */
  reviewWindowEnd: string;
  /** Review window start as an ISO string. */
  reviewWindowStart: string;
  /** Stable user id owning the agent. */
  userId: string;
}

/** Input for listing digest-ish topic activity rows. */
export interface ListTopicActivityInput extends NightlyReviewReadInput {}

/** Input for listing managed skill summaries. */
export interface ListManagedSkillsInput extends NightlyReviewReadInput {}

/** Input for listing relevant memory summaries. */
export interface ListRelevantMemoriesInput extends NightlyReviewReadInput {}

/** Digest evidence counters and ids that can make a topic high-signal. */
export interface NightlyReviewTopicSignalFields {
  /** Number of correction events or correction-like markers in the topic. */
  correctionCount?: number;
  /** Stable ids for correction messages or operations. */
  correctionIds?: string[];
  /** Stable ids for failed tool calls. */
  failedToolCallIds?: string[];
  /** Number of failed tool calls in the topic. */
  failedToolCount?: number;
  /** Number of failure events in the topic. */
  failureCount?: number;
  /** Stable ids for failure messages, operations, or tasks. */
  failureIds?: string[];
  /** Whether the digest source already classified this topic as correction-bearing. */
  hasCorrection?: boolean;
  /** Whether the digest source already classified this topic as failed-tool-bearing. */
  hasFailedTool?: boolean;
  /** Whether the digest source already classified this topic as failure-bearing. */
  hasFailure?: boolean;
  /** Whether the digest source already classified this topic as negative-feedback-bearing. */
  hasNegativeFeedback?: boolean;
  /** Whether the digest source already classified this topic as receipt-bearing. */
  hasReceipt?: boolean;
  /** Number of negative feedback events in the topic. */
  negativeFeedbackCount?: number;
  /** Stable ids for negative feedback messages or reactions. */
  negativeFeedbackIds?: string[];
  /** Number of receipt events connected to the topic. */
  receiptCount?: number;
  /** Stable ids for receipt records. */
  receiptIds?: string[];
}

/** Bounded failed tool-call evidence safe to include in nightly review context. */
export interface NightlyReviewFailedToolCallSummary {
  /** Tool API name when available. */
  apiName?: string | null;
  /** Short serialized error summary. */
  errorSummary?: string | null;
  /** Tool identifier when available. */
  identifier?: string | null;
  /** Message id that carried this failed tool call. */
  messageId: string;
  /** Tool call id when available. */
  toolCallId?: string | null;
}

/** Bounded failed message evidence safe to include in nightly review context. */
export interface NightlyReviewFailedMessageSummary {
  /** Short serialized error summary. */
  errorSummary?: string | null;
  /** Failed message id. */
  messageId: string;
}

/** Topic digest row returned by the injected topic activity boundary. */
export interface NightlyReviewTopicActivityRow extends NightlyReviewTopicSignalFields {
  /** Optional digest metadata that callers may pass through to reviewers. */
  attributes?: Record<string, unknown>;
  /** Evidence refs from upstream digest construction. Preserved when provided. */
  evidenceRefs?: EvidenceRef[];
  /** Bounded failed message evidence rows. */
  failedMessages?: NightlyReviewFailedMessageSummary[];
  /** Bounded failed tool-call evidence rows. */
  failedToolCalls?: NightlyReviewFailedToolCallSummary[];
  /** Stable topic id. */
  id?: string;
  /** Last topic activity as an ISO string, used only as a deterministic tie-breaker. */
  lastActivityAt?: string;
  /** Total digest message count. Raw messages must not be included in collector output. */
  messageCount?: number;
  /** Raw transcript payloads from upstream sources. These are intentionally stripped. */
  rawMessages?: readonly unknown[];
  /** Digest summary safe to pass into review context. */
  summary?: string;
  /** Stable task ids represented by this topic digest. */
  taskIds?: string[];
  /** Human-readable digest title. */
  title?: string;
  /** Stable topic id when the source distinguishes row id from topic id. */
  topicId?: string;
}

/** Managed skill summary returned by the injected skill boundary. */
export interface NightlyReviewManagedSkillSummary {
  /** Optional digest metadata for reviewer context. */
  attributes?: Record<string, unknown>;
  /** Short skill description. */
  description?: string;
  /** Managed skill document id. */
  documentId?: string;
  /** Stable skill name. */
  name: string;
  /** Whether this skill is writable by shared flows. */
  readonly?: boolean;
  /** Last skill update as an ISO string. */
  updatedAt?: string;
}

/** Relevant memory summary returned by the injected memory boundary. */
export interface NightlyReviewRelevantMemorySummary {
  /** Optional digest metadata for reviewer context. */
  attributes?: Record<string, unknown>;
  /** Memory content summary or compact memory text. */
  content: string;
  /** Evidence refs already attached to this memory summary. */
  evidenceRefs?: EvidenceRef[];
  /** Stable memory id. */
  id: string;
  /** Last memory update as an ISO string. */
  updatedAt?: string;
}

/** Bounded successful or failed tool activity grouped by tool identifier and API name. */
export interface ToolActivityDigest {
  /** Tool API name, such as `createDocument`, when recorded by the tool runner. */
  apiName?: string | null;
  /** Number of failed tool calls in the group. */
  failedCount: number;
  /** First use in the review window as an ISO string. */
  firstUsedAt?: string;
  /** Tool identifier, such as `lobe-agent-documents`, when recorded by the tool runner. */
  identifier?: string | null;
  /** Last use in the review window as an ISO string. */
  lastUsedAt?: string;
  /** Message ids that carried this tool activity, bounded by the read adapter. */
  messageIds: string[];
  /** Redacted argument samples, bounded and safe for reviewer context. */
  sampleArgs: string[];
  /** Error samples, bounded and safe for reviewer context. */
  sampleErrors: string[];
  /** Topic ids where the tool appeared, bounded by the read adapter. */
  topicIds: string[];
  /** Total tool call count in the group. */
  totalCount: number;
}

/** Bounded document event used by nightly document activity buckets. */
export interface DocumentEventDigest {
  /** Agent document row id. */
  agentDocumentId: string;
  /** Canonical document id. */
  documentId: string;
  /** Why this document event was bucketed this way. */
  reason: string;
  /** Short document title when available. */
  title?: string | null;
  /** Last update inside the review window as an ISO string. */
  updatedAt: string;
}

/** Document event with explicit skill-shared evidence. */
export interface SkillDocumentEventDigest extends DocumentEventDigest {
  /** Whether metadata explicitly says this document was hinted as a skill. */
  hintIsSkill: boolean;
  /** Optional skill file type or policy format metadata when known. */
  skillFileType?: string | null;
}

/** Review-window document activity grouped by shared relevance. */
export interface DocumentActivityDigest {
  /** Weak or unclear document events. */
  ambiguousBucket: DocumentEventDigest[];
  /** Count and reasons for events omitted from reviewer context. */
  excludedSummary: { count: number; reasons: string[] };
  /** Ordinary document activity that cannot independently trigger skill self-review. */
  generalDocumentBucket: DocumentEventDigest[];
  /** Skill-like document events, primarily `hintIsSkill:true`. */
  skillBucket: SkillDocumentEventDigest[];
}

/** One existing satisfaction judgement reused by nightly review. */
export interface FeedbackSatisfactionDigest {
  /** Confidence from the existing satisfaction judgement. */
  confidence: number;
  /** Judgement creation time as an ISO string. */
  createdAt: string;
  /** Bounded evidence text from the existing judgement. */
  evidence: string;
  /** Message id judged by the online satisfaction path. */
  messageId: string;
  /** Existing judgement reason. */
  reason: string;
  /** Existing satisfaction result. */
  result: 'satisfied' | 'not_satisfied';
  /** Optional topic id for grounding. */
  topicId?: string;
}

/** Existing satisfaction judgements grouped for self-review. */
export interface FeedbackActivityDigest {
  /** Number of neutral judgements suppressed from detailed context. */
  neutralCount: number;
  /** Negative satisfaction judgements that may reinforce repair proposals. */
  notSatisfied: FeedbackSatisfactionDigest[];
  /** Positive satisfaction judgements that may reinforce preserving a workflow. */
  satisfied: FeedbackSatisfactionDigest[];
}

/** Bounded receipt summary visible to nightly review. */
export interface ReceiptActivityItemDigest {
  /** Receipt id. */
  id: string;
  /** Receipt kind. */
  kind: 'review' | 'memory' | 'review' | 'skill';
  /** Optional structured receipt metadata used to surface reflection intents in review. */
  metadata?: Record<string, unknown>;
  /** Receipt status. */
  status: 'applied' | 'completed' | 'failed' | 'proposed' | 'skipped' | 'updated';
  /** Short receipt summary. */
  summary?: string;
  /** Target id or scope key when available. */
  targetId?: string;
}

/** Duplicate proposal group summarized from recent receipts. */
export interface ReceiptDuplicateGroupDigest {
  /** Count of repeated matching receipts. */
  count: number;
  /** Stable grouping key, such as target id plus action type. */
  key: string;
  /** Representative receipt ids. */
  receiptIds: string[];
}

/** Recent receipt history used to suppress repeated self-review proposals. */
export interface ReceiptActivityDigest {
  /** Count of applied or updated receipts. */
  appliedCount: number;
  /** Repeated proposal or action groups. */
  duplicateGroups: ReceiptDuplicateGroupDigest[];
  /** Count of failed receipts. */
  failedCount: number;
  /** Count of pending proposed receipts. */
  pendingProposalCount: number;
  /** Bounded recent receipts. */
  recentReceipts: ReceiptActivityItemDigest[];
  /** Count of review receipts. */
  reviewCount: number;
}

/** Bounded unresolved proposal visible to nightly review. */
export interface SelfReviewProposalDigest {
  /** Dominant action type represented by this proposal. */
  actionType: ActionType;
  /** Last known conflict reason when the proposal became stale or blocked. */
  conflictReason?: string;
  /** Proposal creation ISO timestamp. */
  createdAt: string;
  /** Number of bounded evidence refs attached to the proposal. */
  evidenceCount: number;
  /** Proposal expiry ISO timestamp. */
  expiresAt: string;
  /** Daily Brief id or durable proposal id. */
  proposalId: string;
  /** Stable one-pending-proposal key for this action target. */
  proposalKey: string;
  /** Current lifecycle status. */
  status: SelfReviewProposalStatus;
  /** Short proposal summary safe to inject into reviewer context. */
  summary: string;
  /** Target id when available. */
  targetId?: string;
  /** Human-readable target title when available. */
  targetTitle?: string;
  /** Last proposal update ISO timestamp. */
  updatedAt: string;
}

/** Existing unresolved proposal row activity summarized for nightly review. */
export interface ProposalActivityDigest {
  /** Active proposals that may be refreshed, superseded, or kept pending. */
  active: SelfReviewProposalDigest[];
  /** Count of unresolved proposal rows whose metadata is already dismissed. */
  dismissedCount: number;
  /** Count of unresolved proposal rows whose metadata is expired or whose pending expiry passed. */
  expiredCount: number;
  /** Count of unresolved proposal rows whose metadata is stale. */
  staleCount: number;
  /** Count of unresolved proposal rows whose metadata is superseded. */
  supersededCount: number;
}

/** Nightly self-review signal shown to the reviewer before raw buckets. */
export interface SelfReviewSignal {
  /** Evidence refs that justify the signal. */
  evidenceRefs: EvidenceRef[];
  /** Extensible signal features. */
  features: SelfReviewSignalFeature[];
  /** Signal category. */
  kind: SelfReviewSignalKind;
  /** Conservative signal strength. */
  strength: 'weak' | 'medium' | 'strong';
}

/** Initial nightly self-review signal categories. */
export type SelfReviewSignalKind =
  | 'durable_user_preference'
  | 'frequent_tool_workflow'
  | 'hinted_skill_document_changed'
  | 'pending_related_proposal_exists'
  | 'repeated_tool_failure'
  | 'skill_document_with_tool_failure'
  | 'skill_documents_maybe_overlap';

/** Extensible feature bag attached to self-review signals. */
export type SelfReviewSignalFeature =
  | {
      confidence: number;
      reason: string;
      result: 'satisfied' | 'not_satisfied' | 'neutral';
      type: 'feedback_satisfaction';
    }
  | {
      documentCount: number;
      eventCount: number;
      hintIsSkill: boolean;
      type: 'document_hint';
    }
  | {
      appliedCount: number;
      dedupedCount: number;
      failedCount: number;
      pendingProposalCount: number;
      type: 'receipt_history';
    }
  | {
      apiName?: string | null;
      failedCount: number;
      identifier?: string | null;
      topicCount: number;
      totalCount: number;
      type: 'tool_usage';
    }
  | {
      correctionCount: number;
      hasCorrection: boolean;
      messageCount: number;
      topicId?: string;
      type: 'topic_signal';
    };

/** Normalized topic digest emitted in nightly review context. */
export interface NightlyReviewTopicDigest extends Omit<
  NightlyReviewTopicActivityRow,
  'rawMessages'
> {
  /** Evidence refs suitable for later non-noop draft actions. */
  evidenceRefs: EvidenceRef[];
  /** Ordered high-signal labels found on this topic. Empty for ordinary topics. */
  highSignalReasons: NightlyReviewHighSignalReason[];
  /** Deterministic collector score used for sorting digest topics. */
  reviewScore: number;
}

/** Read adapters used by the pure nightly review collector service. */
export interface NightlyReviewReadAdapters {
  /** Lists review-window document activity grouped by later server adapters. */
  listDocumentActivity?: (input: NightlyReviewReadInput) => Promise<DocumentActivityDigest>;
  /** Lists existing satisfaction judgements for this agent and review window. */
  listFeedbackActivity?: (input: NightlyReviewReadInput) => Promise<FeedbackActivityDigest>;
  /** Lists managed skill summaries for this agent and review window. */
  listManagedSkills: (input: ListManagedSkillsInput) => Promise<NightlyReviewManagedSkillSummary[]>;
  /** Lists existing self-review proposal activity for this agent. */
  listProposalActivity?: (input: NightlyReviewReadInput) => Promise<ProposalActivityDigest>;
  /** Lists recent receipt activity relevant to this review window. */
  listReceiptActivity?: (input: NightlyReviewReadInput) => Promise<ReceiptActivityDigest>;
  /** Lists relevant memory summaries for this agent and review window. */
  listRelevantMemories: (
    input: ListRelevantMemoriesInput,
  ) => Promise<NightlyReviewRelevantMemorySummary[]>;
  /** Lists grouped tool activity for this agent and review window. */
  listToolActivity?: (input: NightlyReviewReadInput) => Promise<ToolActivityDigest[]>;
  /** Lists digest-first topic activity rows for this agent and review window. */
  listTopicActivity: (input: ListTopicActivityInput) => Promise<NightlyReviewTopicActivityRow[]>;
}

/** Input for collecting one nightly review context. */
export interface CollectNightlyReviewContextInput {
  /** Stable agent id being reviewed. */
  agentId: string;
  /**
   * Maximum managed skill summaries in the returned context.
   *
   * @default 20
   */
  maxManagedSkills?: number;
  /**
   * Maximum relevant memory summaries in the returned context.
   *
   * @default 20
   */
  maxRelevantMemories?: number;
  /**
   * Maximum topic digests in the returned context.
   *
   * @default 30
   */
  maxTopics?: number;
  /** Review window end as an ISO string. */
  reviewWindowEnd: string;
  /** Review window start as an ISO string. */
  reviewWindowStart: string;
  /**
   * Optional upstream topic fetch budget before local ranking clips output.
   *
   * @default `maxTopics * 3`
   */
  topicFetchLimit?: number;
  /** Stable user id owning the agent. */
  userId: string;
}

/** Digest-first context consumed by nightly self-reflection reviewers. */
export interface NightlyReviewContext {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Review-window document activity grouped by shared relevance. */
  documentActivity: DocumentActivityDigest;
  /** Existing satisfaction judgements grouped for reviewer context. */
  feedbackActivity: FeedbackActivityDigest;
  /** Managed skills relevant to the agent. */
  managedSkills: NightlyReviewManagedSkillSummary[];
  /** Existing self-review proposals used to refresh or supersede pending decisions. */
  proposalActivity: ProposalActivityDigest;
  /** Recent receipt history used to avoid duplicate proposals. */
  receiptActivity: ReceiptActivityDigest;
  /** Memories relevant to the review window and agent. */
  relevantMemories: NightlyReviewRelevantMemorySummary[];
  /** Review window end as an ISO string. */
  reviewWindowEnd: string;
  /** Review window start as an ISO string. */
  reviewWindowStart: string;
  /** Reflection-mode self-feedback candidates available to nightly self-review. */
  selfFeedbackCandidates: RankedSelfFeedbackCandidate[];
  /** Conservative self-review signals used as reviewer entry points. */
  selfReviewSignals: SelfReviewSignal[];
  /** Ranked topic digests with evidence refs and no raw messages. */
  toolActivity: ToolActivityDigest[];
  /** Ranked topic digests with evidence refs and no raw messages. */
  topics: NightlyReviewTopicDigest[];
  /** Stable user id owning the agent. */
  userId: string;
}

/** Self-review context collector service API. */
export interface SelfReviewContextService {
  /**
   * Collects bounded digest context for one nightly self-reflection review.
   *
   * Use when:
   * - A nightly review source handler needs reviewer context
   * - The caller must avoid mutating memory, skills, shared state, or queues
   *
   * Expects:
   * - Dependencies return digest summaries instead of raw unbounded transcripts
   * - Review windows are already computed by the scheduler or source event
   *
   * Returns:
   * - A deterministic, bounded context containing topics, managed skills, and relevant memories
   */
  collect: (input: CollectNightlyReviewContextInput) => Promise<NightlyReviewContext>;
}

const hasSignal = (count: number | undefined, flag: boolean | undefined) =>
  flag === true || (count ?? 0) > 0;

const getHighSignalReasons = (
  row: NightlyReviewTopicActivityRow,
): NightlyReviewHighSignalReason[] => {
  return HIGH_SIGNAL_REASON_ORDER.filter((reason) => {
    if (reason === 'failure') return hasSignal(row.failureCount, row.hasFailure);
    if (reason === 'negative_feedback') {
      return hasSignal(row.negativeFeedbackCount, row.hasNegativeFeedback);
    }
    if (reason === 'correction') return hasSignal(row.correctionCount, row.hasCorrection);
    if (reason === 'failed_tool') return hasSignal(row.failedToolCount, row.hasFailedTool);

    return hasSignal(row.receiptCount, row.hasReceipt);
  });
};

const getReasonCount = (
  row: NightlyReviewTopicActivityRow,
  reason: NightlyReviewHighSignalReason,
) => {
  if (reason === 'failure') return Math.max(row.failureCount ?? 0, row.hasFailure ? 1 : 0);
  if (reason === 'negative_feedback') {
    return Math.max(row.negativeFeedbackCount ?? 0, row.hasNegativeFeedback ? 1 : 0);
  }
  if (reason === 'correction') return Math.max(row.correctionCount ?? 0, row.hasCorrection ? 1 : 0);
  if (reason === 'failed_tool')
    return Math.max(row.failedToolCount ?? 0, row.hasFailedTool ? 1 : 0);

  return Math.max(row.receiptCount ?? 0, row.hasReceipt ? 1 : 0);
};

const scoreTopic = (
  row: NightlyReviewTopicActivityRow,
  reasons: NightlyReviewHighSignalReason[],
) => {
  return reasons.reduce(
    (score, reason) => score + HIGH_SIGNAL_SCORE_WEIGHTS[reason] * getReasonCount(row, reason),
    row.messageCount ?? 0,
  );
};

const pushUniqueRef = (refs: EvidenceRef[], ref: EvidenceRef) => {
  if (refs.some((existing) => existing.id === ref.id && existing.type === ref.type)) return;

  refs.push(ref);
};

const synthesizeEvidenceRefs = (row: NightlyReviewTopicActivityRow): EvidenceRef[] => {
  const refs: EvidenceRef[] = [];
  const topicId = row.topicId ?? row.id;

  if (topicId) pushUniqueRef(refs, { id: topicId, type: 'topic' });

  for (const taskId of row.taskIds ?? []) {
    pushUniqueRef(refs, { id: taskId, type: 'task' });
  }

  for (const failureId of row.failureIds ?? []) {
    pushUniqueRef(refs, { id: failureId, type: 'operation' });
  }

  for (const failedMessage of row.failedMessages ?? []) {
    pushUniqueRef(refs, { id: failedMessage.messageId, type: 'message' });
  }

  for (const feedbackId of row.negativeFeedbackIds ?? []) {
    pushUniqueRef(refs, { id: feedbackId, type: 'message' });
  }

  for (const correctionId of row.correctionIds ?? []) {
    pushUniqueRef(refs, { id: correctionId, type: 'message' });
  }

  for (const toolCallId of row.failedToolCallIds ?? []) {
    pushUniqueRef(refs, { id: toolCallId, type: 'tool_call' });
  }

  for (const failedToolCall of row.failedToolCalls ?? []) {
    if (failedToolCall.toolCallId) {
      pushUniqueRef(refs, { id: failedToolCall.toolCallId, type: 'tool_call' });
    } else {
      pushUniqueRef(refs, { id: failedToolCall.messageId, type: 'message' });
    }
  }

  for (const receiptId of row.receiptIds ?? []) {
    pushUniqueRef(refs, { id: receiptId, type: 'receipt' });
  }

  return refs;
};

const sanitizeTopicAttributes = (
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!attributes) return undefined;

  const sanitizedAttributes = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !RAW_ATTRIBUTE_KEYS.has(key.toLowerCase())),
  );

  return Object.keys(sanitizedAttributes).length > 0 ? sanitizedAttributes : undefined;
};

const normalizeTopic = (row: NightlyReviewTopicActivityRow): NightlyReviewTopicDigest => {
  const { attributes, rawMessages: _rawMessages, ...digestRow } = row;
  const highSignalReasons = getHighSignalReasons(row);
  const sanitizedAttributes = sanitizeTopicAttributes(attributes);

  return {
    ...digestRow,
    ...(sanitizedAttributes ? { attributes: sanitizedAttributes } : {}),
    evidenceRefs:
      row.evidenceRefs && row.evidenceRefs.length > 0
        ? row.evidenceRefs
        : synthesizeEvidenceRefs(row),
    highSignalReasons,
    reviewScore: scoreTopic(row, highSignalReasons),
  };
};

const parseSortableTimestamp = (timestamp: string | undefined) => {
  if (!timestamp) return 0;

  const parsed = Date.parse(timestamp);

  return Number.isFinite(parsed) ? parsed : 0;
};

const compareTopics = (left: NightlyReviewTopicDigest, right: NightlyReviewTopicDigest) => {
  const leftHighSignalBucket = left.highSignalReasons.length > 0 ? 1 : 0;
  const rightHighSignalBucket = right.highSignalReasons.length > 0 ? 1 : 0;

  if (leftHighSignalBucket !== rightHighSignalBucket) {
    return rightHighSignalBucket - leftHighSignalBucket;
  }

  if (left.reviewScore !== right.reviewScore) return right.reviewScore - left.reviewScore;

  const leftLastActivity = parseSortableTimestamp(left.lastActivityAt);
  const rightLastActivity = parseSortableTimestamp(right.lastActivityAt);

  if (leftLastActivity !== rightLastActivity) return rightLastActivity - leftLastActivity;

  return (left.topicId ?? left.id ?? '').localeCompare(right.topicId ?? right.id ?? '');
};

const createEmptyDocumentActivity = (): DocumentActivityDigest => ({
  ambiguousBucket: [],
  excludedSummary: { count: 0, reasons: [] },
  generalDocumentBucket: [],
  skillBucket: [],
});

/**
 * Maps database document activity rows into self-review buckets.
 *
 * Use when:
 * - Server runtime adapters need to keep DB row shape separate from reviewer context shape
 * - Tests need deterministic document bucket behavior without opening database connections
 *
 * Expects:
 * - Rows are already scoped to one user, one agent, and one review window
 *
 * Returns:
 * - Document activity buckets where only skill bucket rows can support skill self-review
 */
export const mapNightlyDocumentActivityRows = (
  rows: AgentSignalDocumentActivityRow[],
): DocumentActivityDigest => {
  const digest = createEmptyDocumentActivity();

  for (const row of rows) {
    const base = {
      agentDocumentId: row.agentDocumentId,
      documentId: row.documentId,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    };

    if (row.hintIsSkill === true) {
      digest.skillBucket.push({
        ...base,
        hintIsSkill: true,
        reason: 'metadata.agentSignal.hintIsSkill=true',
        skillFileType: row.policyLoadFormat,
      });
      continue;
    }

    if (
      row.templateId === 'agent-skill' ||
      row.templateId === 'skills/index' ||
      row.templateId === 'skills/bundle'
    ) {
      digest.skillBucket.push({
        ...base,
        hintIsSkill: false,
        reason: `templateId=${row.templateId}`,
        skillFileType: row.templateId,
      });
      continue;
    }

    if (row.hintIsSkill === false) {
      digest.generalDocumentBucket.push({
        ...base,
        reason: 'metadata.agentSignal.hintIsSkill=false',
      });
      continue;
    }

    digest.ambiguousBucket.push({
      ...base,
      reason: 'missing agentSignal hint metadata',
    });
  }

  return digest;
};

const createEmptyFeedbackActivity = (): FeedbackActivityDigest => ({
  neutralCount: 0,
  notSatisfied: [],
  satisfied: [],
});

const createEmptyReceiptActivity = (): ReceiptActivityDigest => ({
  appliedCount: 0,
  duplicateGroups: [],
  failedCount: 0,
  pendingProposalCount: 0,
  recentReceipts: [],
  reviewCount: 0,
});

const createEmptyProposalActivity = (): ProposalActivityDigest => ({
  active: [],
  dismissedCount: 0,
  expiredCount: 0,
  staleCount: 0,
  supersededCount: 0,
});

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const toString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const toStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const toEvidenceRefs = (value: unknown, fallbackReceiptId: string): EvidenceRef[] => {
  if (!Array.isArray(value)) return [{ id: fallbackReceiptId, type: 'receipt' }];

  const refs = value.flatMap((item): EvidenceRef[] => {
    const record = toRecord(item);
    const id = toString(record?.id);
    const type = toString(record?.type);

    if (!id) return [];

    if (
      type === 'topic' ||
      type === 'message' ||
      type === 'operation' ||
      type === 'source' ||
      type === 'receipt' ||
      type === 'tool_call' ||
      type === 'task' ||
      type === 'agent_document' ||
      type === 'memory'
    ) {
      return [{ id, type }];
    }

    return [];
  });

  return refs.length > 0 ? refs : [{ id: fallbackReceiptId, type: 'receipt' }];
};

const toIntentTarget = (value: unknown): SelfFeedbackIntent['target'] | undefined => {
  const record = toRecord(value);
  if (!record) return;

  return {
    memoryId: toString(record.memoryId),
    readonly: typeof record.readonly === 'boolean' ? record.readonly : undefined,
    skillDocumentId: toString(record.skillDocumentId),
    skillName: toString(record.skillName),
    taskIds: toStringArray(record.taskIds),
    topicIds: toStringArray(record.topicIds),
  };
};

const isIntentType = (value: unknown): value is SelfFeedbackIntent['intentType'] =>
  value === 'memory' || value === 'skill' || value === 'tooling' || value === 'workflow';

const isRisk = (value: unknown): value is SelfFeedbackIntent['risk'] =>
  value === 'high' || value === 'low' || value === 'medium';

const isUrgency = (value: unknown): value is SelfFeedbackIntent['urgency'] =>
  value === 'immediate' || value === 'later' || value === 'soon';

const toReflectionIntent = (
  value: unknown,
  receipt: ReceiptActivityItemDigest,
): SelfFeedbackIntent | undefined => {
  const record = toRecord(value);
  if (!record || record.mode !== 'reflection') return;

  const intentType = isIntentType(record.intentType) ? record.intentType : undefined;
  const rationale = toString(record.rationale);
  if (!intentType || !rationale) return;

  return normalizeReflectionIntent({
    actionType: toString(record.actionType),
    confidence: typeof record.confidence === 'number' ? record.confidence : undefined,
    downgradeReason:
      record.downgradeReason === 'approval_required' ||
      record.downgradeReason === 'low_confidence' ||
      record.downgradeReason === 'unsupported_in_reflection'
        ? record.downgradeReason
        : undefined,
    evidenceRefs: toEvidenceRefs(record.evidenceRefs, receipt.id),
    idempotencyKey: toString(record.idempotencyKey) ?? receipt.id,
    intentType,
    mode: 'reflection',
    operation: toRecord(record.operation) as SelfFeedbackIntent['operation'],
    rationale,
    risk: isRisk(record.risk) ? record.risk : 'medium',
    target: toIntentTarget(record.target),
    title: toString(record.title),
    urgency: isUrgency(record.urgency) ? record.urgency : 'later',
  });
};

const getReflectionIntentPayloads = (receipt: ReceiptActivityItemDigest): unknown[] => {
  const selfIteration = toRecord(receipt.metadata?.selfIteration);
  if (!selfIteration || selfIteration.mode !== 'reflection') return [];

  if (Array.isArray(selfIteration.intents)) return selfIteration.intents;
  if (selfIteration.intent) return [selfIteration.intent];
  if (selfIteration.intentType) return [selfIteration];

  return [];
};

const getSelfFeedbackReviewCandidates = (receiptActivity: ReceiptActivityDigest) => {
  const intents = receiptActivity.recentReceipts.flatMap((receipt) =>
    getReflectionIntentPayloads(receipt).flatMap((payload) => {
      const intent = toReflectionIntent(payload, receipt);

      return intent ? [intent] : [];
    }),
  );

  return rankSelfFeedbackCandidates(groupSelfFeedbackIntents(intents));
};

/**
 * Creates a pure nightly review collector service from digest read adapters.
 *
 * Use when:
 * - Source handlers need bounded review context before reviewer/planner execution
 * - Tests need deterministic topic ranking without server data adapters
 *
 * Expects:
 * - Read adapters do not enqueue sources or mutate memory/skills
 * - Topic rows are digest-first summaries; raw transcript fields are discarded if present
 *
 * Returns:
 * - A collector service with one context assembly method
 */
export const createSelfReviewContextService = (
  readAdapters: NightlyReviewReadAdapters,
): SelfReviewContextService => {
  const collect = async (
    input: CollectNightlyReviewContextInput,
  ): Promise<NightlyReviewContext> => {
    return tracer.startActiveSpan(
      'agent_signal.nightly_review.collector.collect',
      {
        attributes: {
          'agent.signal.agent_id': input.agentId,
          'agent.signal.nightly.max_managed_skills':
            input.maxManagedSkills ?? DEFAULT_MAX_MANAGED_SKILLS,
          'agent.signal.nightly.max_memories':
            input.maxRelevantMemories ?? DEFAULT_MAX_RELEVANT_MEMORIES,
          'agent.signal.nightly.max_topics': input.maxTopics ?? DEFAULT_MAX_TOPICS,
          'agent.signal.user_id': input.userId,
        },
      },
      async (span) => {
        try {
          const maxTopics = input.maxTopics ?? DEFAULT_MAX_TOPICS;
          const maxManagedSkills = input.maxManagedSkills ?? DEFAULT_MAX_MANAGED_SKILLS;
          const maxRelevantMemories = input.maxRelevantMemories ?? DEFAULT_MAX_RELEVANT_MEMORIES;
          const readInput = {
            agentId: input.agentId,
            reviewWindowEnd: input.reviewWindowEnd,
            reviewWindowStart: input.reviewWindowStart,
            userId: input.userId,
          };

          const [
            topicRows,
            managedSkills,
            relevantMemories,
            toolActivity,
            documentActivity,
            feedbackActivity,
            receiptActivity,
            proposalActivity,
          ] = await Promise.all([
            readAdapters.listTopicActivity({
              ...readInput,
              limit: input.topicFetchLimit ?? maxTopics * 3,
            }),
            readAdapters.listManagedSkills({
              ...readInput,
              limit: maxManagedSkills,
            }),
            readAdapters.listRelevantMemories({
              ...readInput,
              limit: maxRelevantMemories,
            }),
            readAdapters.listToolActivity?.(readInput) ?? Promise.resolve([]),
            readAdapters.listDocumentActivity?.(readInput) ??
              Promise.resolve(createEmptyDocumentActivity()),
            readAdapters.listFeedbackActivity?.(readInput) ??
              Promise.resolve(createEmptyFeedbackActivity()),
            readAdapters.listReceiptActivity?.(readInput) ??
              Promise.resolve(createEmptyReceiptActivity()),
            readAdapters.listProposalActivity?.(readInput) ??
              Promise.resolve(createEmptyProposalActivity()),
          ]);
          const topics = topicRows.map(normalizeTopic).sort(compareTopics).slice(0, maxTopics);
          const selfReviewSignals = deriveSelfReviewSignals({
            documentActivity,
            feedbackActivity,
            receiptActivity,
            toolActivity,
            topics,
          });
          const selfFeedbackCandidates = getSelfFeedbackReviewCandidates(receiptActivity);

          span.setAttribute('agent.signal.nightly.raw_topic_count', topicRows.length);
          span.setAttribute('agent.signal.nightly.topic_count', topics.length);
          span.setAttribute(
            'agent.signal.nightly.high_signal_topic_count',
            topics.filter((topic) => topic.highSignalReasons.length > 0).length,
          );
          span.setAttribute('agent.signal.nightly.managed_skill_count', managedSkills.length);
          span.setAttribute('agent.signal.nightly.memory_count', relevantMemories.length);
          span.setAttribute('agent.signal.nightly.tool_activity_count', toolActivity.length);
          span.setAttribute(
            'agent.signal.nightly.document_skill_event_count',
            documentActivity.skillBucket.length,
          );
          span.setAttribute(
            'agent.signal.nightly.document_general_event_count',
            documentActivity.generalDocumentBucket.length,
          );
          span.setAttribute(
            'agent.signal.nightly.feedback_satisfied_count',
            feedbackActivity.satisfied.length,
          );
          span.setAttribute(
            'agent.signal.nightly.feedback_not_satisfied_count',
            feedbackActivity.notSatisfied.length,
          );
          span.setAttribute(
            'agent.signal.nightly.receipt_pending_proposal_count',
            receiptActivity.pendingProposalCount,
          );
          span.setAttribute(
            'agent.signal.nightly.proposal_active_count',
            proposalActivity.active.length,
          );
          span.setAttribute(
            'agent.signal.nightly.proposal_expired_count',
            proposalActivity.expiredCount,
          );
          span.setAttribute(
            'agent.signal.nightly.proposal_dismissed_count',
            proposalActivity.dismissedCount,
          );
          span.setAttribute(
            'agent.signal.nightly.proposal_stale_count',
            proposalActivity.staleCount,
          );
          span.setAttribute(
            'agent.signal.nightly.proposal_superseded_count',
            proposalActivity.supersededCount,
          );
          span.setAttribute(
            'agent.signal.nightly.self_review_signal_count',
            selfReviewSignals.length,
          );
          span.addEvent('agent_signal.nightly_review.self_review_signals_derived', {
            'agent.signal.nightly.self_review_signal_count': selfReviewSignals.length,
            'agent.signal.nightly.self_review_signal_kinds': selfReviewSignals
              .map((signal) => signal.kind)
              .join(','),
          });
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            ...readInput,
            documentActivity,
            feedbackActivity,
            selfReviewSignals,
            managedSkills: managedSkills.slice(0, maxManagedSkills),
            proposalActivity,
            receiptActivity,
            relevantMemories: relevantMemories.slice(0, maxRelevantMemories),
            toolActivity,
            topics,
            selfFeedbackCandidates,
          };
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message:
              error instanceof Error
                ? error.message
                : 'AgentSignal nightly review context collection failed',
          });
          span.recordException(error as Error);

          throw error;
        } finally {
          span.end();
        }
      },
    );
  };

  return {
    collect,
  };
};
