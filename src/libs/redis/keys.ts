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
   * AI generation related keys (agent welcome, placeholders, etc.)
   */
  AI_GENERATION: 'aiGeneration',
  /**
   * Core LOBEHUB application keys (sessions, cache, etc.)
   */
  LOBEHUB: 'lobechat',
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
   * AI generation scope - for AI-generated content like welcome messages
   */
  aiGeneration: {
    /**
     * Agent welcome message and open questions
     * Full key: aiGeneration:agent_welcome:{agentId}
     */
    agentWelcome: (agentId: string): string => `agent_welcome:${agentId}`,
  },
  /**
   * Lobechat core scope - for application-level caching
   */
  lobechat: {
    // Add lobechat scope keys here as needed
  },
} as const;
