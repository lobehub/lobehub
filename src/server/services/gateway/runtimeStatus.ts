import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { buildRuntimeKey } from '@/server/services/bot/platforms/utils';

import {
  BOT_RUNTIME_STATUSES,
  type BotRuntimeStatus,
  type BotRuntimeStatusSnapshot,
} from '../../../types/botRuntimeStatus';

const BOT_RUNTIME_STATUS_KEY_PREFIX = 'bot:runtime-status';
const FALLBACK_STATUS_UPDATED_AT = 0;

export { BOT_RUNTIME_STATUSES };
export type { BotRuntimeStatus, BotRuntimeStatusSnapshot };

interface UpdateBotRuntimeStatusParams {
  applicationId: string;
  errorMessage?: string;
  platform: string;
  status: BotRuntimeStatus;
}

interface UpdateBotRuntimeStatusOptions {
  now?: number;
  redisClient?: ReturnType<typeof getAgentRuntimeRedisClient>;
  ttlMs?: number;
}

function createFallbackStatus(platform: string, applicationId: string): BotRuntimeStatusSnapshot {
  return {
    applicationId,
    platform,
    status: BOT_RUNTIME_STATUSES.disconnected,
    updatedAt: FALLBACK_STATUS_UPDATED_AT,
  };
}

function extractErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getRuntimeStatusKey(platform: string, applicationId: string): string {
  return `${BOT_RUNTIME_STATUS_KEY_PREFIX}:${buildRuntimeKey(platform, applicationId)}`;
}

export function getRuntimeStatusErrorMessage(error: unknown): string | undefined {
  return extractErrorMessage(error);
}

export async function getBotRuntimeStatus(
  platform: string,
  applicationId: string,
  redisClient: ReturnType<typeof getAgentRuntimeRedisClient> = getAgentRuntimeRedisClient(),
): Promise<BotRuntimeStatusSnapshot> {
  if (!redisClient) {
    return createFallbackStatus(platform, applicationId);
  }

  const raw = await redisClient.get(getRuntimeStatusKey(platform, applicationId));
  if (!raw) return createFallbackStatus(platform, applicationId);

  try {
    return JSON.parse(raw) as BotRuntimeStatusSnapshot;
  } catch {
    await redisClient.del(getRuntimeStatusKey(platform, applicationId));
    return createFallbackStatus(platform, applicationId);
  }
}

export async function updateBotRuntimeStatus(
  params: UpdateBotRuntimeStatusParams,
  options: UpdateBotRuntimeStatusOptions = {},
): Promise<BotRuntimeStatusSnapshot> {
  const redisClient = options.redisClient ?? getAgentRuntimeRedisClient();
  const snapshot: BotRuntimeStatusSnapshot = {
    applicationId: params.applicationId,
    errorMessage: params.errorMessage,
    platform: params.platform,
    status: params.status,
    updatedAt: options.now ?? Date.now(),
  };

  if (!redisClient) return snapshot;

  const key = getRuntimeStatusKey(params.platform, params.applicationId);
  const payload = JSON.stringify(snapshot);

  if (options.ttlMs && options.ttlMs > 0) {
    await (redisClient as any).set(
      key,
      payload,
      'EX',
      Math.max(1, Math.ceil(options.ttlMs / 1000)),
    );
  } else {
    await (redisClient as any).set(key, payload);
  }

  return snapshot;
}
