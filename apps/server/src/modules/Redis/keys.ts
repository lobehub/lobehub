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
   * AI generation related keys (agent welcome, placeholders, etc.)
   */
  AI_GENERATION: 'aiGeneration',
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
   * Lobechat core scope - for application-level caching
   */
  lobechat: {
    // Add lobechat scope keys here as needed
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
  agentSignal: RedisKeyNamespace.AGENT_SIGNAL,
  aiGeneration: RedisKeyNamespace.AI_GENERATION,
  lobechat: RedisKeyNamespace.LOBEHUB,
  sendPathCache: RedisKeyNamespace.SEND_PATH_CACHE,
} as const satisfies Record<
  keyof typeof RedisKeys,
  (typeof RedisKeyNamespace)[keyof typeof RedisKeyNamespace]
>;

/** A {@link RedisKeys} scope, e.g. `sendPathCache` or `agentSignal`. */
export type RedisKeyScope = keyof typeof RedisKeyScopeNamespace;
