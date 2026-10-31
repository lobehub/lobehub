import type { ChatTopicMetadata, ChatTopicStatus, TopicQuerySortBy } from '@lobechat/types';
import type { TimingSink } from '@lobechat/utils';

import { type TopicItem } from '../../schemas';

export type OnboardingSessionMetadataPatch = Partial<
  NonNullable<ChatTopicMetadata['onboardingSession']>
>;

export type RunningOperation = NonNullable<ChatTopicMetadata['runningOperation']>;

export type RunningOperationPatch = Omit<
  Partial<RunningOperation>,
  'childOperations' | 'operationId'
>;

export type TopicMetadataPatch = Omit<Partial<ChatTopicMetadata>, 'onboardingSession'> & {
  onboardingSession?: OnboardingSessionMetadataPatch;
};

export interface SettleRunningOperationOptions {
  /**
   * Refuse to clear a marker whose operation row is still `running` /
   * `waiting_for_async_tool`. Set for client-reported settles, which can be
   * triggered by an early or mirrored terminal event.
   */
  rejectInFlightOperation?: boolean;
}

export interface TopicListItem extends TopicItem {
  /** The topic's last non-empty assistant reply, truncated with a trailing `…`. Only set when `queryTopics` is called with `withLastMessage`. */
  lastAssistantMessage?: string | null;
  /**
   * Visibility of the agent/group this topic belongs to — `'private'` marks a
   * conversation that must stay out of shared/team listings even though the
   * viewer may own it. Null for legacy rows with no resolvable parent.
   */
  parentVisibility?: 'private' | 'public' | null;
  /**
   * When the topic's current run started (`agent_operations.startedAt` of its
   * latest top-level running operation). Only computed for `running` topics;
   * null for everything else, and for runs that never wrote an operation row
   * (e.g. client-mode runs) — callers must keep a fallback.
   */
  runStartedAt?: Date | null;
}

/**
 * Sanitized projection of `topics.metadata.runningOperation` for a visitor DTO
 * — only the fields `useGatewayReconnect`'s `RunningOperation` needs to resume
 * a streaming session on reload. Never the full `runningOperation` object: it
 * also carries device/hetero fields (`deviceId`, `deviceUserId`, `hooks`, …)
 * that describe creator-side dispatch and must not reach a visitor.
 */
export interface VisitorRunningOperation {
  assistantMessageId: string;
  heteroType?: string | null;
  operationId: string;
  scope?: string;
  /** Liveness/elapsed-time stamp — see `useGatewayReconnect`'s `startedAt`. */
  startedAt?: string;
  threadId?: string | null;
}

/**
 * Visitor-facing topic DTO for the agent-share surface. Deliberately narrow:
 * the underlying row is CREATOR-owned and also carries the creator's userId,
 * model/provider snapshot, cost/usage and internal metadata.
 */
export interface VisitorTopicItem {
  createdAt: Date;
  id: string;
  /**
   * Sanitized `runningOperation` marker, present only while a run is active on
   * this topic. Lets the share surface reconnect a Gateway stream after a page
   * reload — see {@link VisitorRunningOperation} for why it's projected
   * instead of forwarding `topics.metadata.runningOperation` as-is.
   */
  runningOperation?: VisitorRunningOperation | null;
  title: string | null;
  updatedAt: Date;
}

export interface CreateTopicParams {
  agentId?: string | null;
  favorite?: boolean;
  groupId?: string | null;
  messages?: string[];
  metadata?: ChatTopicMetadata;
  /** Pinned model snapshot, persisted to the top-level `topics.model` column. */
  model?: string | null;
  /** Owning business project, independent of the execution directory. */
  projectId?: string | null;
  /** Project directory this conversation is pinned to as its execution context. */
  projectWorkingDirectoryId?: string | null;
  provider?: string | null;
  /**
   * Agent-share visitor topics carry the CREATOR's `userId` (billing/data
   * attribution) plus the visitor's id here, so creator-facing listings
   * exclude them (`notShareVisitorTopic`, applied by `query`, `count`,
   * `queryTopics`, `queryRecent` and `rank`) while the share surface scopes
   * reads per visitor (`queryBySender` / `countBySender`).
   *
   * A future opt-in surface (`allowCreatorViewSessions`) may let a creator
   * explicitly browse visitor sessions; that is not wired up yet — every
   * creator-facing read today unconditionally excludes senderId rows.
   */
  senderId?: string | null;
  sessionId?: string | null;
  /**
   * Initial status. Defaults to the column default (`active`). A topic created
   * with `metadata.scheduledRun` must set `scheduled` here so the status and the
   * payload land in the same insert — the dispatcher treats the pair as one fact.
   */
  status?: ChatTopicStatus;
  title?: string;
  trigger?: string | null;
}

export interface QueryTopicParams {
  agentId?: string | null;
  /**
   * @deprecated Use agentId or groupId instead. Kept for backward compatibility.
   * Container ID (sessionId or groupId) to filter topics by
   */
  containerId?: string | null;
  current?: number;
  /**
   * Restrict an `agentId` query to the builder conversations that configured
   * one specific target (`metadata.editingAgentId` / `metadata.editingGroupId`).
   *
   * Builder panels run on a single builtin agent shared by every target, whose
   * topics deliberately carry no `groupId` / `sessionId` — those columns mark a
   * topic as part of the target's own chat read path. The builder panel itself
   * shows the unfiltered history on purpose; these exist so a caller that wants
   * one target's builds can ask for them. Only meaningful alongside `agentId`;
   * ignored by the group / container branches.
   */
  editingAgentId?: string | null;
  editingGroupId?: string | null;
  /**
   * Exclude topics by status (e.g. ['completed'])
   */
  excludeStatuses?: string[];
  /**
   * Exclude topics by trigger types (e.g. ['cron'])
   * Ignored when includeTriggers is provided.
   */
  excludeTriggers?: string[];
  /**
   * Group ID to filter topics by
   */
  groupId?: string | null;
  /**
   * Include only topics whose trigger matches one of these values.
   * Takes precedence over excludeTriggers when provided.
   */
  includeTriggers?: string[];
  /**
   * Whether this is an inbox agent query.
   * When true, also includes legacy inbox topics (sessionId IS NULL AND groupId IS NULL AND agentId IS NULL)
   */
  isInbox?: boolean;
  /** Include unassigned legacy topics only after the caller resolves this Session to the Agent. */
  legacySessionId?: string | null;
  /**
   * Only topics the caller created (`topics.userId`). Meaningful in a
   * workspace, where the list otherwise shows every member's topics.
   */
  onlyMine?: boolean;
  pageSize?: number;
  /**
   * Server-side ordering. Defaults to `updatedAt`. `status` orders by status
   * priority (see `STATUS_SORT_RANK`) so the sidebar "group by status" mode
   * keeps high-priority topics on the first page.
   */
  sortBy?: TopicQuerySortBy;
  timing?: ModelTimingContext;
  /**
   * Include only topics matching the given trigger types (positive filter)
   */
  triggers?: string[];
  /**
   * When true, the SELECT also returns the heavier card-detail columns used
   * by the per-agent Topics management page: `firstUserMessage` (subquery),
   * `messageCount` (subquery), `description`, `trigger`. `cost` and
   * `tokenUsage` are intentionally omitted until a dedicated schema migration
   * adds real columns to back them. Defaults to false so sidebar paths stay
   * cheap.
   */
  withDetails?: boolean;
}

export interface ModelTimingContext extends TimingSink {}

/**
 * Scope used to constrain a keyword search to a single conversation owner.
 * Mirrors the precedence of {@link TopicModel.query}: groupId > agentId >
 * containerId (legacy sessionId / groupId).
 */
export interface TopicKeywordScope {
  agentId?: string | null;
  /**
   * @deprecated Use agentId or groupId instead. Only consulted when neither
   * agentId nor groupId is provided (legacy / mobile string-arg callers).
   * Container ID (sessionId or groupId) to filter topics by.
   */
  containerId?: string | null;
  groupId?: string | null;
}

export interface ListTopicsForMemoryExtractorCursor {
  createdAt: Date;
  id: string;
}
