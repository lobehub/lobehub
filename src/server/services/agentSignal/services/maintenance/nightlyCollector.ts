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

/** Topic digest row returned by the injected topic activity boundary. */
export interface NightlyReviewTopicActivityRow extends NightlyReviewTopicSignalFields {
  /** Optional digest metadata that callers may pass through to reviewers. */
  attributes?: Record<string, unknown>;
  /** Evidence refs from upstream digest construction. Preserved when provided. */
  evidenceRefs?: EvidenceRef[];
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
  /** Lists managed skill summaries for this agent and review window. */
  listManagedSkills: (input: ListManagedSkillsInput) => Promise<NightlyReviewManagedSkillSummary[]>;
  /** Lists relevant memory summaries for this agent and review window. */
  listRelevantMemories: (
    input: ListRelevantMemoriesInput,
  ) => Promise<NightlyReviewRelevantMemorySummary[]>;
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
  /** Managed skills relevant to the agent. */
  managedSkills: NightlyReviewManagedSkillSummary[];
  /** Memories relevant to the review window and agent. */
  relevantMemories: NightlyReviewRelevantMemorySummary[];
  /** Review window end as an ISO string. */
  reviewWindowEnd: string;
  /** Review window start as an ISO string. */
  reviewWindowStart: string;
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

  for (const feedbackId of row.negativeFeedbackIds ?? []) {
    pushUniqueRef(refs, { id: feedbackId, type: 'message' });
  }

  for (const correctionId of row.correctionIds ?? []) {
    pushUniqueRef(refs, { id: correctionId, type: 'message' });
  }

  for (const toolCallId of row.failedToolCallIds ?? []) {
    pushUniqueRef(refs, { id: toolCallId, type: 'tool_call' });
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
      const maxTopics = input.maxTopics ?? DEFAULT_MAX_TOPICS;
      const maxManagedSkills = input.maxManagedSkills ?? DEFAULT_MAX_MANAGED_SKILLS;
      const maxRelevantMemories = input.maxRelevantMemories ?? DEFAULT_MAX_RELEVANT_MEMORIES;
      const readInput = {
        agentId: input.agentId,
        reviewWindowEnd: input.reviewWindowEnd,
        reviewWindowStart: input.reviewWindowStart,
        userId: input.userId,
      };

      const [topicRows, managedSkills, relevantMemories] = await Promise.all([
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
      ]);

      return {
        ...readInput,
        managedSkills: managedSkills.slice(0, maxManagedSkills),
        relevantMemories: relevantMemories.slice(0, maxRelevantMemories),
        topics: topicRows.map(normalizeTopic).sort(compareTopics).slice(0, maxTopics),
      };
    },
  };
};
