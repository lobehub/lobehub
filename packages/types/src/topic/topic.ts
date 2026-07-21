import { z } from 'zod';

import type { SerializedAgentHook } from '../agentHook';
import { serializedAgentHookSchema } from '../agentHook';
import type { WorkingDirConfig } from '../device';
import { workingDirConfigSchema } from '../device';
import type { BaseDataModel } from '../meta';
import type { OnboardingUnderstandingSession } from '../understanding';

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
  understanding?: OnboardingUnderstandingSession;
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
  /**
   * For topics imported from local CLI transcripts: the source transcript's
   * last message timestamp at import time. The import picker compares it with
   * a fresh scan's endAt to detect "the transcript grew since last import"
   * (message counts are not comparable across transcript records and DB rows).
   */
  heteroSourceEndAt?: string;
  /** origin marker for imported topics, e.g. `claude-code-local` / `codex-local` */
  importedFrom?: string;
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
  /**
   * A deferred agent run on this topic. Present iff the topic status is
   * `scheduled`. Set to `null` to clear it (same clear-convention as
   * `runningOperation`); every reader treats a nullish value as "not scheduled".
   */
  scheduledRun?: TopicScheduledRun | null;
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

/**
 * What a {@link TopicScheduledRun} does when it comes due.
 *
 * - `resume_after_rate_limit`: a heterogeneous turn that hit a provider rate
 *   limit; resumes the surviving CLI session from the failed assistant turn.
 * - `delayed_start`: a run the user deliberately deferred ("send this in 3
 *   hours"); replays a stored `execAgent` request as a fresh turn.
 */
export const TOPIC_SCHEDULED_RUN_KINDS = ['resume_after_rate_limit', 'delayed_start'] as const;

export type TopicScheduledRunKind = (typeof TOPIC_SCHEDULED_RUN_KINDS)[number];

/**
 * Lease taken by the cron dispatcher before it dispatches a scheduled run, so
 * two concurrent ticks / replicas never trigger the same run twice. Kind-agnostic.
 */
const topicScheduledRunClaimSchema = z.object({
  claimedAt: z.string(),
  expiresAt: z.string(),
  id: z.string(),
});

const topicScheduledRunBaseSchema = z.object({
  claim: topicScheduledRunClaimSchema.optional(),
  createdAt: z.string(),
  /**
   * The single due gate — the cron dispatches a scheduled topic once
   * `runAt <= now`, regardless of kind. Required: a scheduled run with no
   * `runAt` would otherwise be indistinguishable from "due immediately".
   *
   * Must be a UTC ISO-8601 timestamp (`…Z`, what `Date#toISOString` emits). The
   * dispatcher's due query compares it as text against `now().toISOString()`, so
   * a zoned offset (`…+08:00`) would silently break the ordering.
   */
  runAt: z.string().datetime(),
  updatedAt: z.string(),
});

const resumeAfterRateLimitRunSchema = topicScheduledRunBaseSchema.extend({
  /** The failed assistant turn that hit the rate limit (regenerated in place). */
  failedAssistantMessageId: z.string(),
  kind: z.literal('resume_after_rate_limit'),
  /** Diagnostics only — `runAt` is derived from `resetsAt` at write time. */
  rateLimit: z
    .object({ rateLimitType: z.string().optional(), resetsAt: z.number().optional() })
    .optional(),
  /** Resume snapshot; both fields are derivable from topic metadata but cached here. */
  resume: z
    .object({ sessionId: z.string().optional(), workingDirectory: z.string().optional() })
    .optional(),
  source: z.literal('heterogeneous_agent'),
  /** The user message whose turn is being continued. */
  userMessageId: z.string(),
});

const delayedStartRunSchema = topicScheduledRunBaseSchema.extend({
  kind: z.literal('delayed_start'),
  /** Model override captured at schedule time (the agent default is used if absent). */
  model: z.string().optional(),
  /** Provider override captured at schedule time. */
  provider: z.string().optional(),
  /**
   * The user turn to run when due. Persisted as a real message at schedule time,
   * so the pending prompt reads as the user's own words in the topic (and in any
   * list rendering the last message) instead of hiding in metadata.
   *
   * This message — not a copy in this payload — is the single source of truth for
   * the prompt: the dispatcher reads its content back, so editing a pending run
   * is just editing the message.
   */
  userMessageId: z.string(),
});

/**
 * A deferred agent run on a topic: *when* to run (`runAt`), a lease so only one
 * replica dispatches it (`claim`), and *what* to run (the `kind` variant).
 *
 * Stored on `topic.metadata.scheduledRun` and paired with topic
 * `status = 'scheduled'` — the two are written and cleared together, so a
 * scheduled topic always carries a dispatchable payload. The cron dispatcher
 * scans due topics and re-enters `AiAgentService.execAgent`; it does NOT enter
 * TaskLifecycle. Recurrence is deliberately out of scope: repeated execution
 * belongs to `tasks.automationMode = 'schedule'`.
 */
export const topicScheduledRunSchema = z.discriminatedUnion('kind', [
  resumeAfterRateLimitRunSchema,
  delayedStartRunSchema,
]);

export type TopicScheduledRunClaim = z.infer<typeof topicScheduledRunClaimSchema>;
export type ResumeAfterRateLimitRun = z.infer<typeof resumeAfterRateLimitRunSchema>;
export type DelayedStartRun = z.infer<typeof delayedStartRunSchema>;
export type TopicScheduledRun = z.infer<typeof topicScheduledRunSchema>;

/**
 * The pre-`kind` payload, written by the first version of this mechanism (which
 * only ever parked rate-limited hetero continuations). It has neither `kind` nor
 * `runAt`: the due gate was `rateLimit.resetsAt` (epoch seconds), and an absent
 * one meant "due now".
 *
 * Rows in this shape are sitting in the DB when this code deploys, so the reader
 * upgrades them rather than a migration backfilling them — a scheduled run is
 * cleared the moment it dispatches, so the legacy shape drains on its own.
 */
const legacyRateLimitRunSchema = z.object({
  claim: topicScheduledRunClaimSchema.optional(),
  createdAt: z.string(),
  failedAssistantMessageId: z.string(),
  // Legacy by definition — a payload that carries a `kind` but failed the union
  // above is corrupt, and must be discarded rather than read as a rate limit.
  kind: z.undefined().optional(),
  rateLimit: z
    .object({ rateLimitType: z.string().optional(), resetsAt: z.number().optional() })
    .optional(),
  reason: z.literal('rate_limit'),
  resume: z
    .object({ sessionId: z.string().optional(), workingDirectory: z.string().optional() })
    .optional(),
  source: z.literal('heterogeneous_agent'),
  updatedAt: z.string(),
  userMessageId: z.string(),
});

/**
 * Read a stored `scheduledRun` in either the current or the legacy shape, or
 * `null` when it is neither (the caller discards those — see the dispatcher).
 *
 * Pairs with the due query in `TopicModel.getDueScheduledTopics`, which carries
 * the matching legacy fallback: the two must agree on what "due" means, or a row
 * this upgrades would never be selected in the first place.
 */
export const parseTopicScheduledRun = (raw: unknown): TopicScheduledRun | null => {
  const current = topicScheduledRunSchema.safeParse(raw);
  if (current.success) return current.data;

  const legacy = legacyRateLimitRunSchema.safeParse(raw);
  if (!legacy.success) return null;

  const { kind: _kind, reason: _reason, ...rest } = legacy.data;

  return {
    ...rest,
    kind: 'resume_after_rate_limit',
    // Reproduce the old gate exactly: the rate-limit reset if there was one, and
    // otherwise "due immediately" — which `createdAt`, always in the past, is.
    runAt: rest.rateLimit?.resetsAt
      ? new Date(rest.rateLimit.resetsAt * 1000).toISOString()
      : rest.createdAt,
  };
};

/** Metadata patch accepted by the topic update API. */
export const chatTopicMetadataUpdateSchema = z.object({
  boundDeviceId: z.string().optional(),
  heteroSessionId: z.string().optional(),
  heteroSessionIdByWorkingDirectory: z.record(z.string(), z.string()).optional(),
  model: z.string().optional(),
  onboardingFeedback: z
    .object({
      comment: z.string().max(500).optional(),
      rating: z.enum(['good', 'bad']),
      submittedAt: z.string(),
    })
    .optional(),
  onboardingSession: z
    .object({
      agentIdentityCompletedAt: z.string().optional(),
      agentMarketplacePick: z
        .object({
          categoryHints: z.array(z.string()),
          installedAgentIds: z.array(z.string()).optional(),
          requestId: z.string(),
          resolvedAt: z.string(),
          selectedTemplateIds: z.array(z.string()).optional(),
          skipReason: z.string().optional(),
          skippedAgentIds: z.array(z.string()).optional(),
          status: z.enum(['cancelled', 'skipped', 'submitted']),
        })
        .optional(),
      discoveryCompletedAt: z.string().optional(),
      finalAgentNames: z.array(z.string()).optional(),
      finishedAt: z.string().optional(),
      lastActiveAt: z.string().optional(),
      phase: z.enum(['agent_identity', 'user_identity', 'discovery', 'summary']).optional(),
      startedAt: z.string().optional(),
      userIdentityCompletedAt: z.string().optional(),
      version: z.number().optional(),
    })
    .optional(),
  provider: z.string().optional(),
  repos: z.array(z.string()).optional(),
  runningOperation: z
    .object({
      assistantMessageId: z.string(),
      hooks: z.array(serializedAgentHookSchema).optional(),
      operationId: z.string(),
      scope: z.string().optional(),
      threadId: z.string().nullish(),
    })
    .nullable()
    .optional(),
  scheduledRun: topicScheduledRunSchema.nullish(),
  workingDirectory: z.string().optional(),
  workingDirectoryConfig: workingDirConfigSchema.optional(),
});

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
  'scheduled',
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
