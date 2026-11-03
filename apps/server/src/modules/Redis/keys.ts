/**
 * Centralized Redis key definitions
 *
 * All Redis keys should be defined here for easy management and consistency.
 *
 * Structure:
 * - RedisKeyNamespace: Contains all available prefixes
 * - RedisKeys: Contains key builders organized by namespace/scope
 */

/**
 * Redis key namespace prefixes
 *
 * Each prefix creates an isolated keyspace in Redis.
 * When using `createRedisWithPrefix`, pass one of these as the prefix parameter.
 */
export const RedisKeyNamespace = {
  /**
   * Agent Signal keys — the same `agent-signal` keyspace the Agent Signal runtime
   * stores (receipts, dedupe, policy state) already use.
   */
  AGENT_SIGNAL: 'agent-signal',
  /**
   * Follow-ups a user queued behind a running agent turn ("steer"). The server
   * drains them into the next turn itself when the running one hands back.
   */
  AGENT_STEER: 'agentSteer',
  /**
   * Agent identity keys — replay claims for agent-account provider webhooks,
   * shared by every instance that may receive a delivery.
   */
  AGENT_IDENTITY: 'agent-identity',
  /**
   * Bot-wake channel state: when the bot and its owner last spoke, the follow-up window, the
   * silent-wake budget and the per-channel wake scheduler.
   */
  BOT_WAKE: 'bot-wake',
  /**
   * AI generation related keys (agent welcome, placeholders, etc.)
   */
  AI_GENERATION: 'aiGeneration',
  /**
   * Third-party integrations (Linear, …): OAuth hand-off state.
   */
  INTEGRATIONS: 'integrations',
  /**
   * Core LOBEHUB application keys (sessions, cache, etc.)
   */
  LOBEHUB: 'lobechat',
  /**
   * Short-lived derived answers the send path would otherwise re-fetch per
   * turn (device system info, a skill's live tool list) and the one-shot
   * claims that keep their background refreshes from piling up.
   */
  SEND_PATH_CACHE: 'sendPathCache',
} as const;

/**
 * Redis key builders organized by namespace/scope
 *
 * Usage:
 * ```ts
 * // Get full key: agent_welcome:{agentId}
 * const key = RedisKeys.aiGeneration.agentWelcome(agentId);
 *
 * // Use with Redis client (prefix is added by createRedisWithPrefix)
 * const redis = await createRedisWithPrefix(config, RedisKeyNamespace.AI_GENERATION);
 * await redis.get(key);
 * // Actual Redis key: aiGeneration:agent_welcome:{agentId}
 * ```
 */
export const RedisKeys = {
  /**
   * Agent Signal spend bounds — see {@link RedisKeyNamespace.AGENT_SIGNAL}. Per-user
   * counters and quotas that keep background self-iteration work within its limits.
   */
  agentSignal: {
    /**
     * Feedback-classifier calls one user made on one UTC day.
     * Full key: agent-signal:classifier_calls:v1:{userId}:{utcDay}
     */
    classifierCalls: (userId: string, utcDay: string): string =>
      `classifier_calls:v1:${userId}:${utcDay}`,
    /**
     * Self-feedback declarations accepted in one topic scope.
     * Full key: agent-signal:declaration_slots:v1:{scopeKey}
     */
    declarationSlots: (scopeKey: string): string => `declaration_slots:v1:${scopeKey}`,
    /**
     * Manual Agent Signal triggers one user sent in the current hourly window.
     * Full key: agent-signal:manual_triggers:v1:{userId}
     */
    manualTriggers: (userId: string): string => `manual_triggers:v1:${userId}`,
    /**
     * Distinct topics one user's nightly review covered on one local night.
     * Full key: agent-signal:nightly_topics:v1:{userId}:{localDate}
     */
    nightlyTopics: (userId: string, localDate: string): string =>
      `nightly_topics:v1:${userId}:${localDate}`,
  },
  /**
   * Bot-wake scope — see {@link RedisKeyNamespace.BOT_WAKE}. `{key}` is a channel or thread key
   * built by the bot-wake scenario (`platform:applicationId:channel[:thread]`).
   */
  botWake: {
    /**
     * Classifier calls one bot made in one UTC hour.
     * Full key: bot-wake:classifier_calls:v1:{applicationId}:{utcHour}
     */
    classifierCalls: (applicationId: string, utcHour: string): string =>
      `classifier_calls:v1:${applicationId}:${utcHour}`,
    /**
     * Who spoke last in one channel or thread, the follow-up window and the silent-wake count.
     * Full key: bot-wake:channel:v1:{key}
     */
    channel: (key: string): string => `channel:v1:${key}`,
    /**
     * The wake a bot already decided to start for one message, kept while the message is parked
     * so its replay runs on that decision instead of judging the message a second time.
     * Full key: bot-wake:initiation:v1:{applicationId}:{messageId}
     */
    initiation: (applicationId: string, messageId: string): string =>
      `initiation:v1:${applicationId}:${messageId}`,
    /**
     * Set once a message has engaged a bot: it @-mentioned the bot when sent, the bot replied to
     * it, or an edit already woke the bot on it. An edit that newly @-mentions the bot wakes it only
     * while this key is absent, so one message never wakes the same bot twice.
     * Full key: bot-wake:edit_wake:v1:{applicationId}:{messageId}
     */
    editWake: (applicationId: string, messageId: string): string =>
      `edit_wake:v1:${applicationId}:${messageId}`,
    /**
     * The last messages said in one channel or thread, shared by every bot listening there, so it
     * carries no application id.
     * Full key: bot-wake:conversation_log:v1:{key}
     */
    conversationLog: (key: string): string => `conversation_log:v1:${key}`,
    /**
     * Wake scheduler state machine of one channel.
     * Full key: bot-wake:scheduler:v1:{key}
     */
    scheduler: (key: string): string => `scheduler:v1:${key}`,
    /**
     * Short lock held while one writer updates a channel's scheduler state.
     * Full key: bot-wake:scheduler_lock:v1:{key}
     */
    schedulerLock: (key: string): string => `scheduler_lock:v1:${key}`,
  },
  /**
   * Steer queue scope — see {@link RedisKeyNamespace.AGENT_STEER}.
   */
  agentSteer: {
    /**
     * Follow-ups one user queued behind their running turn on one conversation
     * surface. Per user: workspace members can each have a run on the same topic.
     * Full key: agentSteer:follow_ups:v1:{userId}:{topicId}:{threadId|main}
     */
    followUps: (userId: string, topicId: string, threadId?: string | null): string =>
      `follow_ups:v1:${userId}:${topicId}:${threadId || 'main'}`,
    /**
     * Ids of follow-ups a drain already took from that queue, so a retried
     * append of the same id is recognized instead of queued again.
     * Full key: agentSteer:follow_ups_taken:v1:{userId}:{topicId}:{threadId|main}
     */
    takenFollowUps: (userId: string, topicId: string, threadId?: string | null): string =>
      `follow_ups_taken:v1:${userId}:${topicId}:${threadId || 'main'}`,
    /**
     * Follow-ups a run drained from that queue but has not settled yet, one
     * batch per drain (field = drain id). A batch whose lease lapses goes back
     * to the queue, so an interrupted delivery never loses an entry.
     * Full key: agentSteer:follow_ups_drained:v1:{userId}:{topicId}:{threadId|main}
     */
    drainedFollowUps: (userId: string, topicId: string, threadId?: string | null): string =>
      `follow_ups_drained:v1:${userId}:${topicId}:${threadId || 'main'}`,
    /**
     * Short fence around starting a run on an existing thread. Thread starts
     * skip the topic-start reservation, so this is what lets a queued
     * follow-up check "no run is live here" and start as one step.
     * Full key: agentSteer:thread_start:v1:{threadId}
     */
    threadStartFence: (threadId: string): string => `thread_start:v1:${threadId}`,
  },
  /**
   * Agent identity scope — see {@link RedisKeyNamespace.AGENT_IDENTITY}.
   */
  agentIdentity: {
    /**
     * Replay claim on one provider webhook delivery.
     * Full key: agent-identity:webhook_event:v1:{provider}:{eventId}
     */
    webhookEvent: (provider: string, eventId: string): string =>
      `webhook_event:v1:${provider}:${eventId}`,
  },
  /**
   * AI generation scope - for AI-generated content like welcome messages
   */
  aiGeneration: {
    /**
     * Agent welcome message and open questions
     * Full key: aiGeneration:agent_welcome:{agentId}
     */
    agentWelcome: (agentId: string): string => `agent_welcome:${agentId}`,
    /**
     * Per-user paired { welcome, hint } objects shown on the home page
     * Full key: aiGeneration:home_brief:{userId}
     */
    homeBrief: (userId: string): string => `home_brief:${userId}`,
  },
  /**
   * Integrations scope — see {@link RedisKeyNamespace.INTEGRATIONS}.
   */
  integrations: {
    /**
     * Single-use state of one "Connect Linear" OAuth hand-off.
     * Full key: integrations:linear_oauth_state:v1:{state}
     */
    linearOAuthState: (state: string): string => `linear_oauth_state:v1:${state}`,
  },
  /**
   * Lobechat core scope - for application-level caching
   */
  lobechat: {
    /**
     * Digest of the body the last projection of a page's collaboration room wrote.
     * Full key: lobechat:page_projection:v1:{documentId}
     */
    pageProjection: (documentId: string): string => `page_projection:v1:${documentId}`,
  },
  /**
   * Send-path cache scope — see {@link RedisKeyNamespace.SEND_PATH_CACHE}.
   * Every key carries the identity the answer depends on (user, pool, device,
   * connection), never a shared one.
   */
  sendPathCache: {
    /**
     * A routed device's system info, per principal pool.
     * Full key: sendPathCache:device_system_info:v1:{userId}:{pool}:{deviceId}
     */
    deviceSystemInfo: (userId: string, pool: string, deviceId: string): string =>
      `device_system_info:v1:${userId}:${pool}:${deviceId}`,
    /**
     * One connected LobeHub skill's live tool list, per connection identity.
     * Full key: sendPathCache:lobehub_skill_tools:v1:{userId}:{providerId}:{identity}
     */
    lobehubSkillTools: (userId: string, providerId: string, identity: string): string =>
      `lobehub_skill_tools:v1:${userId}:${providerId}:${identity}`,
    /**
     * Claim held by the one background rescan of a bound directory.
     * Full key: sendPathCache:workspace_rescan_claim:v1:{userId}:{pool}:{deviceId}:{cwd}
     */
    workspaceRescanClaim: (userId: string, pool: string, deviceId: string, cwd: string): string =>
      `workspace_rescan_claim:v1:${userId}:${pool}:${deviceId}:${cwd}`,
  },
} as const;

/**
 * The namespace (key prefix) each {@link RedisKeys} scope lives under. A scope's keys are
 * only read and written through a client prefixed with its namespace, so a key can never
 * land under another scope's prefix. Every scope must be mapped.
 */
export const RedisKeyScopeNamespace = {
  agentIdentity: RedisKeyNamespace.AGENT_IDENTITY,
  agentSignal: RedisKeyNamespace.AGENT_SIGNAL,
  agentSteer: RedisKeyNamespace.AGENT_STEER,
  aiGeneration: RedisKeyNamespace.AI_GENERATION,
  botWake: RedisKeyNamespace.BOT_WAKE,
  integrations: RedisKeyNamespace.INTEGRATIONS,
  lobechat: RedisKeyNamespace.LOBEHUB,
  sendPathCache: RedisKeyNamespace.SEND_PATH_CACHE,
} as const satisfies Record<
  keyof typeof RedisKeys,
  (typeof RedisKeyNamespace)[keyof typeof RedisKeyNamespace]
>;

/** A {@link RedisKeys} scope, e.g. `sendPathCache` or `agentSignal`. */
export type RedisKeyScope = keyof typeof RedisKeyScopeNamespace;
