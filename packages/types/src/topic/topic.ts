import { z } from 'zod';

import type { SerializedAgentHook } from '../agentHook';
import type { WorkingDirConfig } from '../device';
import type { BaseDataModel } from '../meta';

// Type definitions
export type ShareVisibility = 'private' | 'link';

export type TimeGroupId =
  'today' | 'yesterday' | 'week' | 'month' | `${number}-${string}` | `${number}`;

export type TopicGroupMode = 'byTime' | 'byProject' | 'flat' | 'byStatus';
export type TopicSortBy = 'createdAt' | 'updatedAt';

/**
 * Server-side ordering for the topic list query.
 * - `updatedAt` (default): favorites first, then most-recently-updated.
 * - `status`: favorites first, then by status priority
 *   (waitingForHuman → running → active → paused → failed → completed →
 *   archived), then most-recently-updated within each status. Backs the
 *   sidebar "group by status" mode so the highest-priority topics stay on the
 *   first page regardless of pagination.
 */
export type TopicQuerySortBy = 'updatedAt' | 'status';

export interface GroupedTopic {
  children: ChatTopic[];
  id: string;
  title?: string;
}

export interface TopicUserMemoryExtractRunState {
  error?: string;
  lastMessageAt?: string;
  lastRunAt?: string;
  messageCount?: number;
  processedMemoryCount?: number;
  traceId?: string;
}

export interface ChatTopicBotContext {
  applicationId: string;
  /**
   * Whether the message sender is the bot owner. Computed at the bot
   * router/dispatcher entry point as
   *   `senderExternalUserId === settings.userId`.
   *
   * Downstream policy (`resolveDeviceAccessPolicy`) consumes this directly
   * and never recomputes — the routers own the owner-identity check.
   *
   * Fail-closed: if `settings.userId` is missing or the sender ID can't be
   * resolved, this MUST be `false`. Never default to `true` "when in doubt".
   */
  isOwner: boolean;
  /**
   * Set when the run originated from the shared Messenger bot (Telegram global
   * token, Slack per-workspace install, Discord global token). The value is
   * the messenger installation key (`<platform>:<tenantId>` or
   * `<platform>:singleton`) — `BotCallbackService` uses its presence as the
   * deterministic switch to resolve credentials via the messenger install
   * store instead of `agent_bot_providers`.
   */
  messengerInstallationKey?: string;
  platform: string;
  platformThreadId: string;
  /**
   * Platform-assigned ID of the actual sender of the inbound message
   * (e.g. Discord/Slack `user.id`, Telegram `from.id`). Distinct from
   * `applicationId` (the bot itself) — required so downstream code can tell
   * "owner @ bot" apart from "external user @ bot" without re-reading
   * platform-specific message shapes.
   */
  senderExternalUserId: string;
}

export interface OnboardingFeedbackEntry {
  comment?: string;
  rating: 'good' | 'bad';
  submittedAt: string;
}

export interface OnboardingAgentMarketplacePickSnapshot {
  categoryHints: string[];
  installedAgentIds?: string[];
  requestId: string;
  resolvedAt: string;
  selectedTemplateIds?: string[];
  skippedAgentIds?: string[];
  skipReason?: string;
  status: 'cancelled' | 'skipped' | 'submitted';
}

export interface OnboardingSessionSnapshot {
  agentIdentityCompletedAt?: string;
  agentMarketplacePick?: OnboardingAgentMarketplacePickSnapshot;
  discoveryCompletedAt?: string;
  finalAgentNames?: string[];
  finishedAt?: string;
  lastActiveAt: string;
  phase: 'agent_identity' | 'user_identity' | 'discovery' | 'summary';
  startedAt: string;
  userIdentityCompletedAt?: string;
  version: number;
}

export interface ChatTopicMetadata {
  bot?: ChatTopicBotContext;
  boundDeviceId?: string;
  cronJobId?: string;
  /**
   * Scoped pointer to the currently active assistant message for a running
   * heterogeneous agent operation. Includes `operationId` so cold-start
   * replicas only use the value when it belongs to the current operation —
   * preventing a stale pointer from a previous run from corrupting a new one.
   * Updated on every step boundary.
   */
  heteroCurrentMsgId?: { msgId: string; operationId: string };
  /**
   * Persistent session id for a heterogeneous agent.
   * Saved after each turn so the next message in the same topic can resume
   * the conversation (e.g. Claude Code CLI uses `--resume <sessionId>`).
   *
   * Two write paths share this field:
   *
   *   - **Desktop renderer** writes from `executeHeterogeneousAgent` after
   *     the local CLI process finishes. Resume is gated on `workingDirectory`
   *     equality because CC stores sessions per-cwd under
   *     `~/.claude/projects/<encoded-cwd>/`.
   *   - **Cloud server** writes from `aiAgent.heteroFinish` (and from in-stream
   *     terminal events) when the sandbox CLI run completes. The sandbox
   *     mounts a stable cwd, so server-side resume does not check
   *     `workingDirectory`.
   */
  heteroSessionId?: string;
  /**
   * Heterogeneous-agent session ids scoped by effective working directory.
   * Claude Code stores native sessions under a cwd-specific project bucket, so
   * one topic may need different resume ids when the user switches worktrees.
   *
   * `heteroSessionId` remains the currently selected cwd's latest id for legacy
   * readers; this map lets the UI restore the right id when switching back.
   */
  heteroSessionIdByWorkingDirectory?: Record<string, string>;
  model?: string;
  /**
   * Free-form feedback collected after agent onboarding completion.
   * Comment text is stored only here (not analytics) and is length-capped server-side.
   */
  onboardingFeedback?: OnboardingFeedbackEntry;
  onboardingSession?: OnboardingSessionSnapshot;
  provider?: string;
  /**
   * Web (cloud) only. Ordered list of GitHub repos selected for this topic.
   * Each repo will be cloned into the Gateway sandbox before execution.
   * `workingDirectory` is kept in sync with repos[0] (the primary repo).
   */
  repos?: string[];
  /**
   * Currently running Gateway operation on this topic.
   * Set when agent execution starts, cleared when it completes/fails.
   * Used to reconnect WebSocket after page reload.
   */
  runningOperation?: {
    assistantMessageId: string;
    /**
     * Serialized lifecycle hooks (onComplete / onError) registered for this run.
     *
     * Persisted so the heterogeneous-agent terminal path can fire them through
     * the same `hookDispatcher` the normal LLM runtime uses, instead of a
     * bespoke single-webhook callback. Read by every hetero terminal site —
     * the CLI exit (`aiAgent.heteroFinish`), the remote-agent `agentNotify`
     * done signal, and a synchronous dispatch failure — so the task lifecycle
     * (`onTopicComplete`) and IM bot completion callbacks fire uniformly.
     *
     * Only hooks carrying a webhook config are serializable (handler closures
     * can't cross a process boundary); queue mode delivers these webhooks while
     * local mode dispatches the in-memory handlers registered at dispatch time.
     */
    hooks?: SerializedAgentHook[];
    operationId: string;
    scope?: string;
    threadId?: string | null;
  } | null;
  userMemoryExtractRunState?: TopicUserMemoryExtractRunState;
  userMemoryExtractStatus?: 'pending' | 'completed' | 'failed';
  /**
   * Topic-level working directory.
   * On desktop: local filesystem path for the CC session cwd.
   * On web (cloud): URL of the primary GitHub repo (first item of `repos`).
   * Priority is higher than Agent-level settings. Also serves as the
   * binding cwd for a CC session — written on first CC execution and
   * checked on subsequent turns to decide whether `--resume` is safe.
   * For sidebar grouping, topics are bucketed by this field (byProject mode).
   */
  workingDirectory?: string;
  /**
   * Structured topic-level working directory snapshot.
   *
   * Kept as a single object, not a list. `workingDirectory` remains the
   * backwards-compatible effective path; this field preserves the source path
   * and git/worktree metadata needed to restore the same worktree when the user
   * switches back to the topic, and to render branch/worktree context in topic
   * lists without probing the device.
   */
  workingDirectoryConfig?: WorkingDirConfig;
}

export interface ChatTopicSummary {
  content: string;
  model: string;
  provider: string;
}

/**
 * Canonical, ordered list of topic statuses. Single source of truth for both
 * the {@link ChatTopicStatus} type and the {@link chatTopicStatusSchema} zod
 * validator (consumed by the topic TRPC router). Add new statuses here.
 *
 * - `unread`: a completed generation the user hasn't read yet. Persisted so the
 *   unread indicator survives reload and syncs across devices; cleared back to
 *   `active` when the user opens the topic. See operation slice unread actions.
 */
export const TOPIC_STATUSES = [
  'active',
  'running',
  'paused',
  'waitingForHuman',
  'failed',
  'completed',
  'archived',
  'unread',
] as const;

/** Zod validator for {@link ChatTopicStatus}, derived from {@link TOPIC_STATUSES}. */
export const chatTopicStatusSchema = z.enum(TOPIC_STATUSES);

export type ChatTopicStatus = z.infer<typeof chatTopicStatusSchema>;

export interface ChatTopic extends Omit<BaseDataModel, 'meta'> {
  completedAt?: Date | null;
  /** Server-side mock until real cost aggregation lands. */
  cost?: number | null;
  description?: string | null;
  favorite?: boolean;
  /** First user message (sliced server-side, used as preview fallback). */
  firstUserMessage?: string | null;
  historySummary?: string;
  /** Total message count for the topic. */
  messageCount?: number | null;
  metadata?: ChatTopicMetadata;
  sessionId?: string;
  /**
   * Sort key for the sidebar list: the topic's latest message-activity time
   * (server `topicActivityAt`), falling back to `updatedAt`. Kept separate from
   * `updatedAt` so the client sort matches the server ORDER BY (no list jumping)
   * while `updatedAt` still reflects real row edits like rename/favorite.
   * (LOBE-11543)
   */
  sortUpdatedAt?: number;
  status?: ChatTopicStatus | null;
  title: string;
  /** Server-side mock until real token aggregation lands. */
  tokenUsage?: number | null;
  trigger?: string | null;
  userId?: string;
}

export type ChatTopicMap = Record<string, ChatTopic>;

export interface TopicRankItem {
  agentId: string | null;
  count: number;
  id: string;
  title: string | null;
}

export interface RecentTopicAgent {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export interface RecentTopicGroupMember {
  avatar: string | null;
  backgroundColor: string | null;
}

export interface RecentTopicGroup {
  id: string;
  members: RecentTopicGroupMember[];
  title: string | null;
}

export interface RecentTopic {
  agent: RecentTopicAgent | null;
  group: RecentTopicGroup | null;
  id: string;
  title: string | null;
  type: 'agent' | 'group';
  updatedAt: Date;
}

export interface CreateTopicParams {
  favorite?: boolean;
  groupId?: string | null;
  messages?: string[];
  sessionId?: string | null;
  title: string;
  trigger?: string;
}

export interface QueryTopicParams {
  agentId?: string | null;
  current?: number;
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
  pageSize?: number;
  /**
   * Server-side ordering. Defaults to `updatedAt`. Use `status` to back the
   * sidebar "group by status" mode so high-priority topics stay on page one.
   */
  sortBy?: TopicQuerySortBy;
  /**
   * Include only topics matching the given trigger types (positive filter)
   */
  triggers?: string[];
  /**
   * When true, the response includes heavier card-detail fields
   * (`firstUserMessage`, `messageCount`, `description`, `trigger`, plus mock
   * `cost` / `tokenUsage`). Only the per-agent Topics management page opts
   * in — sidebar paths stay lean.
   */
  withDetails?: boolean;
}

/**
 * Shared message data for public sharing
 */
export interface SharedMessage {
  content: string;
  createdAt: Date;
  id: string;
  role: string;
}

/**
 * Shared topic data returned by public API
 */
export interface SharedTopicData {
  agentId: string | null;
  agentMeta?: {
    avatar?: string | null;
    backgroundColor?: string | null;
    marketIdentifier?: string | null;
    slug?: string | null;
    title?: string | null;
  };
  groupId: string | null;
  groupMeta?: {
    avatar?: string | null;
    backgroundColor?: string | null;
    createdAt?: Date | null;
    members?: {
      avatar: string | null;
      backgroundColor: string | null;
      id: string;
      title: string | null;
    }[];
    title?: string | null;
    updatedAt?: Date | null;
    userId?: string | null;
  };
  shareId: string;
  title: string | null;
  topicId: string;
  visibility: ShareVisibility;
}

/**
 * Topic share info returned to the owner
 */
export interface TopicShareInfo {
  id: string;
  topicId: string;
  visibility: ShareVisibility;
}
