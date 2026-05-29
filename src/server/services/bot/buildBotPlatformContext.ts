import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { BotPlatformRuntimeContext } from './platforms/types';

/** Shared runtime context for bot platform clients (webhook URL base, Redis, owner). */
export function buildBotPlatformRuntimeContext(userId: string): BotPlatformRuntimeContext {
  return {
    appUrl: appEnv.APP_URL,
    redisClient: getAgentRuntimeRedisClient() as BotPlatformRuntimeContext['redisClient'],
    userId,
  };
}
