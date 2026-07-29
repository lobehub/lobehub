import { randomUUID } from 'node:crypto';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const SESSION_TTL_SECONDS = 5 * 60;
const FINALIZE_LOCK_TTL_SECONDS = 30;
const SESSION_PREFIX = 'messenger:wechat-qr-session:';
const LOCK_PREFIX = 'messenger:wechat-qr-finalize:';

export interface WechatQrSessionPayload {
  createdAt: number;
  qrcode: string;
  userId: string;
}

const sessionKey = (sessionId: string): string => `${SESSION_PREFIX}${sessionId}`;
const lockKey = (sessionId: string): string => `${LOCK_PREFIX}${sessionId}`;

const getRedis = () => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis is required for WeChat QR session storage');
  return redis;
};

export const issueWechatQrSession = async (
  payload: Omit<WechatQrSessionPayload, 'createdAt'>,
): Promise<{ expiresAt: number; sessionId: string }> => {
  const redis = getRedis();
  const sessionId = randomUUID().replaceAll('-', '');
  const createdAt = Date.now();
  const value: WechatQrSessionPayload = { ...payload, createdAt };

  await redis.set(sessionKey(sessionId), JSON.stringify(value), 'EX', SESSION_TTL_SECONDS);

  return {
    expiresAt: createdAt + SESSION_TTL_SECONDS * 1000,
    sessionId,
  };
};

export const peekWechatQrSession = async (
  sessionId: string,
  userId: string,
): Promise<WechatQrSessionPayload | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as WechatQrSessionPayload;
    if (payload.userId !== userId || !payload.qrcode || !Number.isFinite(payload.createdAt)) {
      return null;
    }
    return payload;
  } catch {
    await redis.del(sessionKey(sessionId));
    return null;
  }
};

/** Returns an ownership token, or null when another poll is finalizing. */
export const acquireWechatQrFinalizeLock = async (sessionId: string): Promise<string | null> => {
  const redis = getRedis();
  const token = randomUUID().replaceAll('-', '');
  const acquired = await redis.set(
    lockKey(sessionId),
    token,
    'EX',
    FINALIZE_LOCK_TTL_SECONDS,
    'NX',
  );
  return acquired === 'OK' ? token : null;
};

export const releaseWechatQrFinalizeLock = async (
  sessionId: string,
  token: string,
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    lockKey(sessionId),
    token,
  );
};

export const consumeWechatQrSession = async (sessionId: string): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  await redis.del(sessionKey(sessionId), lockKey(sessionId));
};
