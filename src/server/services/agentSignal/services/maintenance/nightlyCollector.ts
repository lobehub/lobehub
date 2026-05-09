import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import { deriveNightlyMaintenanceSignals } from './nightlySignals';
import type { EvidenceRef } from './types';

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
  /** Whether this skill is writable by maintenance flows. */
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

/** Document event with explicit skill-maintenance evidence. */
export interface SkillDocumentEventDigest extends DocumentEventDigest {
  /** Whether metadata explicitly says this document was hinted as a skill. */
  hintIsSkill: boolean;
  /** Optional skill file type or policy format metadata when known. */
  skillFileType?: string | null;
}

/** Review-window document activity grouped by maintenance relevance. */
export interface DocumentActivityDigest {
  /** Weak or unclear document events. */
  ambiguousBucket: DocumentEventDigest[];
  /** Count and reasons for events omitted from reviewer context. */
  excludedSummary: { count: number; reasons: string[] };
  /** Ordinary document activity that cannot independently trigger skill maintenance. */
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

/** Existing satisfaction judgements grouped for maintenance review. */
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
  kind: 'maintenance' | 'memory' | 'review' | 'skill';
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

/** Recent receipt history used to suppress repeated maintenance proposals. */
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

/** Nightly maintenance signal shown to the reviewer before raw buckets. */
export interface MaintenanceSignal {
  /** Evidence refs that justify the signal. */
  evidenceRefs: EvidenceRef[];
  /** Extensible signal features. */
  features: MaintenanceSignalFeature[];
  /** Signal category. */
  kind: MaintenanceSignalKind;
  /** Conservative signal strength. */
  strength: 'weak' | 'medium' | 'strong';
}

/** Initial nightly maintenance signal categories. */
export type MaintenanceSignalKind =
  | 'frequent_tool_workflow'
  | 'hinted_skill_document_changed'
  | 'pending_related_proposal_exists'
  | 'repeated_tool_failure'
  | 'skill_document_with_tool_failure'
  | 'skill_documents_maybe_overlap';

/** Extensible feature bag attached to maintenance signals. */
export type MaintenanceSignalFeature =
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
  /** Review-window document activity grouped by maintenance relevance. */
  documentActivity: DocumentActivityDigest;
  /** Existing satisfaction judgements grouped for reviewer context. */
  feedbackActivity: FeedbackActivityDigest;
  /** Conservative maintenance signals used as reviewer entry points. */
  maintenanceSignals: MaintenanceSignal[];
  /** Managed skills relevant to the agent. */
  managedSkills: NightlyReviewManagedSkillSummary[];
  /** Recent receipt history used to avoid duplicate proposals. */
  receiptActivity: ReceiptActivityDigest;
  /** Memories relevant to the review window and agent. */
  relevantMemories: NightlyReviewRelevantMemorySummary[];
  /** Review window end as an ISO string. */
  reviewWindowEnd: string;
  /** Review window start as an ISO string. */
  reviewWindowStart: string;
  /** Ranked topic digests with evidence refs and no raw messages. */
  toolActivity: ToolActivityDigest[];
  /** Ranked topic digests with evidence refs and no raw messages. */
  topics: NightlyReviewTopicDigest[];
  /** Stable user id owning the agent. */
  userId: string;
}

/** Nightly review collector service API. */
export interface NightlyReviewService {
  /**
   * Collects bounded digest context for one nightly self-reflection review.
   *
   * Use when:
   * - A nightly review source handler needs reviewer context
   * - The caller must avoid mutating memory, skills, maintenance state, or queues
   *
   * Expects:
   * - Dependencies return digest summaries instead of raw unbounded transcripts
   * - Review windows are already computed by the scheduler or source event
   *
   * Returns:
   * - A deterministic, bounded context containing topics, managed skills, and relevant memories
   */
  collectNightlyReviewContext: (
    input: CollectNightlyReviewContextInput,
  ) => Promise<NightlyReviewContext>;
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
export const createNightlyReviewService = (
  readAdapters: NightlyReviewReadAdapters,
): NightlyReviewService => {
  return {
    collectNightlyReviewContext: async (input) => {
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
            ]);
            const topics = topicRows.map(normalizeTopic).sort(compareTopics).slice(0, maxTopics);
            const maintenanceSignals = deriveNightlyMaintenanceSignals({
              documentActivity,
              feedbackActivity,
              receiptActivity,
              toolActivity,
            });

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
              'agent.signal.nightly.maintenance_signal_count',
              maintenanceSignals.length,
            );
            span.addEvent('agent_signal.nightly_review.maintenance_signals_derived', {
              'agent.signal.nightly.maintenance_signal_count': maintenanceSignals.length,
              'agent.signal.nightly.maintenance_signal_kinds': maintenanceSignals
                .map((signal) => signal.kind)
                .join(','),
            });
            span.setStatus({ code: SpanStatusCode.OK });

            return {
              ...readInput,
              documentActivity,
              feedbackActivity,
              maintenanceSignals,
              managedSkills: managedSkills.slice(0, maxManagedSkills),
              receiptActivity,
              relevantMemories: relevantMemories.slice(0, maxRelevantMemories),
              toolActivity,
              topics,
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
    },
  };
};
