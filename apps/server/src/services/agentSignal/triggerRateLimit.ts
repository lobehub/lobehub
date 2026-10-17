import { TRPCError } from '@trpc/server';

import { redisService } from '@/server/services/redis';

/**
 * Manual Agent Signal triggers one user may enqueue per rolling-hour bucket.
 *
 * `triggerSourceEvent` exists for CLI / local testing; every accepted call can start a
 * model-backed workflow (a nightly review is a full agent run), so it is bounded per user.
 */
export const AGENT_SIGNAL_TRIGGER_RATE_LIMIT_PER_HOUR = 10;

/**
 * Consumes one manual trigger from the user's hourly budget.
 *
 * Use when:
 * - `triggerSourceEvent` (tRPC or REST) is about to synthesise and enqueue a source event
 *
 * Expects:
 * - `userId` comes from the authenticated context
 *
 * Returns:
 * - `true` when the call is within budget; `false` once the hourly budget is spent
 * - `true` when Redis is not configured: Agent Signal dedupe and review guards cannot run
 *   without Redis either, so there is no model spend for this limit to protect
 */
export const consumeAgentSignalTriggerQuota = async (userId: string): Promise<boolean> => {
  const count = await redisService.agentSignal.countManualTrigger(userId);
  if (count === undefined) return true;

  return count <= AGENT_SIGNAL_TRIGGER_RATE_LIMIT_PER_HOUR;
};

/**
 * Rejects a manual trigger once the user's hourly budget is spent.
 *
 * Throws a `TOO_MANY_REQUESTS` {@link TRPCError}; the REST controller maps it to HTTP 429.
 */
export const assertAgentSignalTriggerRateLimit = async (userId: string) => {
  if (await consumeAgentSignalTriggerQuota(userId)) return;

  throw new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: `Agent Signal trigger limit reached (${AGENT_SIGNAL_TRIGGER_RATE_LIMIT_PER_HOUR} per hour)`,
  });
};
