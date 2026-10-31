import type {
  ChatMessageError,
  ChatToolPayload,
  MessageMetadata,
  MessagePluginItem,
  ModelReasoning,
  ModelUsage,
  UIChatMessage,
  WorkAccessScope,
} from '@lobechat/types';
import type { TimingSink } from '@lobechat/utils';
import type { SQL } from 'drizzle-orm';

export interface HumanApprovalResolution {
  /** Conditional owner checked by rollback; never accepted as client authority. */
  claimedResolutionRequestId?: string;
  content?: string;
  id: string;
  intervention: Record<string, unknown>;
  pluginError?: MessagePluginItem['error'] | null;
  pluginState?: Record<string, unknown> | null;
  replacePluginState?: boolean;
}

/**
 * Options for querying messages with relations
 */
export interface QueryMessagesOptions {
  /**
   * Opt IN to agent-share visitor rows for this call, overriding the default
   * `ownership()` visitor exclusion. Combined via OR with the instance's
   * `includeShareVisitor` flag, so an instance already opted in stays opted
   * in and a default-scoped instance can still be widened per-call (this is
   * how {@link MessageModel.queryForVisitor} works before the share-runtime
   * routers switch to constructing the model with `{ includeShareVisitor:
   * true }`).
   */
  allowShareVisitor?: boolean;
  /**
   * Round-cursor for loading older history (see `QueryMessageParams.before`):
   * only rows strictly older than this `(createdAt, id)` tuple are fetched.
   */
  before?: { createdAt: Date; id: string };
  /**
   * Current page number (0-indexed)
   */
  current?: number;
  /**
   * Constrain MessageGroup assembly to an explicit `[from, before)` time window
   * instead of loading every group in the topic (or deriving the window from the
   * fetched rows). Set by cursor pagination so consecutive pages partition the
   * topic's groups exactly once: a scroll-up page neither repeats group nodes nor
   * drops the ones dated between (or older than) its mainline rows. Either bound
   * may be omitted to leave that side open. Bounds are lossless microsecond
   * timestamp strings compared with a `::timestamptz` cast.
   */
  groupNodeWindow?: MessageGroupNodeWindow;
  /**
   * Opt-in for `file` work summaries in the payload (see
   * `QueryMessageParams.includeFileWorks`).
   */
  includeFileWorks?: boolean;
  /**
   * Number of messages per page
   */
  pageSize?: number;
  /**
   * Post-process function for file URLs
   */
  postProcessUrl?: (
    path: string | null,
    file: { fileType: string; id?: string | null },
  ) => Promise<string>;
  /**
   * Skip the Work-summary assembly (see `QueryMessageParams.skipWorks`).
   */
  skipWorks?: boolean;
  timing?: ModelTimingContext;
  /**
   * Topic ID for MessageGroup aggregation queries
   */
  topicId?: string;
  /**
   * Custom where condition for message filtering
   */
  where?: SQL;
  /**
   * Agent Share boundary for the Work-summary assembly. Omitted = ordinary
   * scope, which never resolves a share visitor's Works; the share read path
   * passes `agentShareWorkAccessScope(...)` so a visitor gets exactly the
   * Works registered from their own share topic.
   */
  workAccessScope?: WorkAccessScope;
}

export interface TopicTranscriptMessage {
  agentId: string | null;
  content: string | null;
  createdAt: Date;
  error: ChatMessageError | null;
  id: string;
  messageGroupId: string | null;
  metadata: MessageMetadata | null;
  model: string | null;
  parentId: string | null;
  pluginError: unknown;
  provider: string | null;
  reasoning: ModelReasoning | null;
  role: string;
  threadId: string | null;
  toolCallId: string | null;
  tools: ChatToolPayload[] | null;
  usage: ModelUsage | null;
}

export interface TopicTranscriptResult {
  items: TopicTranscriptMessage[];
  total: number;
}

/**
 * Cursor for {@link MessageModel.queryTopicMessagesByCursor}. Backward, it points
 * at a mainline `user` message (a round start) and the next page holds the rounds
 * strictly before it; forward, it points at the last row already loaded (any
 * role, when a page split a round) and the next page starts strictly after it.
 */
export interface MessageRoundCursor {
  createdAt: string;
  id: string;
}

export interface QueryTopicByCursorParams {
  /**
   * Ignored: a concrete topic is the conversation boundary and may hold rows
   * from several agents/sessions (e.g. `callAgent` replies), same as `query`.
   * Accepted only so callers can forward their usual query params.
   */
  agentId?: string | null;
  /** Hard cap on rows walked when resolving the round window (safety, ~rows). */
  countBudget?: number;
  /**
   * Omit for the first page (the newest when backward, the oldest when forward);
   * pass a prior `nextCursor` to continue in the same direction.
   */
  cursor?: MessageRoundCursor | null;
  /** `backward` (default) pages newest-first toward older rounds; `forward` from the first round. */
  direction?: 'backward' | 'forward';
  /** Group chat topic: rows carry the group id, same filter as `query`. */
  groupId?: string | null;
  /** See {@link QueryMessageParams.includeFileWorks}. */
  includeFileWorks?: boolean;
  /** How many rounds to load per page (the current round is always whole). */
  roundLimit?: number;
  /** Ignored for the same reason as `agentId`. */
  sessionId?: string | null;
  skipWorks?: boolean;
  topicId: string;
}

export interface TopicMessagesByCursorResult {
  hasMore: boolean;
  messages: UIChatMessage[];
  /** Cursor for the next page in the same direction, or null at the topic's start/end. */
  nextCursor: MessageRoundCursor | null;
}

/** Half-open `[from, before)` MessageGroup window; see `groupNodeWindow`. */
export interface MessageGroupNodeWindow {
  before?: string | null;
  from?: string | null;
}

export interface ModelTimingContext extends TimingSink {}

/**
 * Shared, ownership-scoped filters for the analytics queries
 * (count / countGroupByTopic / topicMessageStats). All of these are
 * applied on top of the workspace ownership predicate, so the resulting
 * query never leaks across `userId × workspace`.
 */
export interface MessageAnalyticsFilters {
  agentId?: string;
  endDate?: string;
  range?: [string, string];
  role?: string;
  startDate?: string;
  topicId?: string;
}

/** A single `{ topicId, count }` row from a per-topic count aggregation. */
export interface TopicMessageCountItem {
  count: number;
  topicId: string;
}

/**
 * Distribution of message counts per topic, computed server-side.
 * Mirrors what a `SELECT count(*) ... GROUP BY topic_id` + percentile
 * aggregation would produce, so the CLI receives only the summary instead
 * of paginating raw rows.
 */
export interface TopicMessageStats {
  /** Per distinct message-count value, how many topics have it. Ascending. */
  histogram: { topics: number; userCount: number }[];
  max: number;
  mean: number;
  median: number;
  min: number;
  /** Number of topics with exactly one matching message ("one-shot"). */
  oneshot: number;
  /** oneshot / topics, in [0, 1]. 0 when there are no topics. */
  oneshotRatio: number;
  p90: number;
  p99: number;
  /** Number of topics that have at least one matching message. */
  topics: number;
  /** Total matching messages across all topics. */
  totalMessages: number;
}

/**
 * Opt-in escape hatch for the write paths that legitimately act on agent-share
 * visitor rows. Visitor messages are stored under the creator's `userId`, so
 * ownership alone cannot tell a creator action apart from a runtime action;
 * mutation entry points therefore fail closed and only the agent runtime (which
 * drives visitor turns under the creator's identity) passes this.
 */
export interface ShareVisitorWriteOptions {
  includeShareVisitor?: boolean;
}

/**
 * Constructor options for {@link MessageModel} — mirrors the twin flag on
 * {@link import('../topic').TopicModelOptions}. When `includeShareVisitor` is
 * true, the instance's `ownership()` predicate no longer excludes agent-share
 * visitor messages; the escape hatch that per-call {@link ShareVisitorWriteOptions}
 * used to be the only way to grant. Share-only surfaces should set this at
 * construction and stop threading per-call opt-ins through their code.
 */
export interface MessageModelOptions {
  includeShareVisitor?: boolean;
}

/**
 * Per-share switches that relax {@link toVisitorMessage}'s default redaction.
 * Both default to `false` (strip everything), so a caller that forgets to pass
 * options gets the fail-closed projection.
 */
export interface VisitorRedactionOptions {
  /**
   * `AgentShareConfig.showErrorDetails`. When false, a run failure is
   * projected down to a generic classified `type` (see
   * {@link sanitizeVisitorError}) instead of the raw
   * message/provider/budget/upstream-body payload `formatErrorForState`
   * builds.
   */
  showErrorDetails?: boolean;
  /**
   * `AgentShareConfig.showModelInfo`. When false, the creator's model /
   * provider choice and the token/cost snapshot are stripped everywhere they
   * appear, at any nesting depth.
   */
  showModelInfo?: boolean;
}

export interface SoftDeletedMessage {
  /** Live children that were re-parented away from this message at trash time. */
  childIds: string[];
  content: string | null;
  id: string;
  /** Pulled in as a tool companion of a requested message (never a root of its own). */
  isCompanion: boolean;
  /**
   * For a companion: the requested message whose tool call produced it, so the
   * caller can file it under the right root. `null` for requested rows.
   */
  ownerId: string | null;
  parentId: string | null;
  projectId: string | null;
  role: string;
  topicId: string | null;
}
