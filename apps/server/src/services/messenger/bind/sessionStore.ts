import { randomUUID } from 'node:crypto';

import { getMessengerLinkTokenTtl, type MessengerPlatform } from '@/config/messenger';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import type { BindKind, BindPollStatus } from './types';

/**
 * Registry behind the unified `startBind` / `pollBind` pair. Every one-click
 * bind gets a record keyed by its `pollId`, so a poll only needs the id to know
 * which platform flow to drive and who may read it.
 *
 * The record also carries what the platform-specific stores do not: the agent
 * the person picked to greet them and the locale to greet in. Link-code flows
 * (Telegram, iMessage) and WeChat QR sessions keep their own state; OAuth
 * flows (Slack, Discord) have no store of their own, so their outcome is
 * settled on this record by the OAuth callback.
 */
export interface BindSession {
  /** Agent the binding lands on and that greets the person afterwards. */
  agentId: string | null;
  createdAt: number;
  kind: BindKind;
  /** UI locale of the page that started the bind; used for the greeting. */
  locale?: string;
  platform: MessengerPlatform;
  pollId: string;
  /** Only meaningful for OAuth flows — the others derive it from their own store. */
  result: BindPollStatus;
  userId: string;
  workspaceId: string | null;
}

/** Outlives the link TTL so a page polling right at expiry still settles. */
const SETTLED_TTL_SECONDS = 24 * 60 * 60;

const sessionKey = (pollId: string): string => `messenger:bind-session:${pollId}`;

const requireRedis = () => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis is required for messenger bind sessions');
  return redis;
};

export const createBindPollId = (): string => randomUUID().replaceAll('-', '');

export const saveBindSession = async (
  session: Omit<BindSession, 'createdAt' | 'result'>,
): Promise<BindSession> => {
  const redis = requireRedis();
  const value: BindSession = { ...session, createdAt: Date.now(), result: { status: 'pending' } };
  await redis.set(
    sessionKey(session.pollId),
    JSON.stringify(value),
    'EX',
    getMessengerLinkTokenTtl() + SETTLED_TTL_SECONDS,
  );
  return value;
};

/** Read a bind session for its owner; anyone else gets null. */
export const peekBindSession = async (
  pollId: string,
  userId?: string,
): Promise<BindSession | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;

  const raw = await redis.get(sessionKey(pollId));
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as BindSession;
    if (userId !== undefined && session.userId !== userId) return null;
    return session;
  } catch {
    return null;
  }
};

/**
 * Compare-and-set in Redis: write the settled record only while the stored
 * result is still `pending`. A `linked` result may also replace a `failed` one
 * — the account link is already committed, so the record must say so — but
 * nothing ever overwrites `linked`. Without this, two callbacks racing on the
 * same bind (the OAuth URL opened twice) could leave a real link reported as
 * failed.
 */
const SETTLE_IF_OPEN_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= 'table' or type(current.result) ~= 'table' then return 0 end
local status = current.result.status
if status == 'pending' or (ARGV[2] == 'linked' and status == 'failed') then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
  return 1
end
return 0
`;

/** Settle a bind once. Resolves `false` when another outcome already won. */
export const settleBindSession = async (
  pollId: string,
  result: Exclude<BindPollStatus, { status: 'pending' | 'scanned' | 'expired' }>,
): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return false;

  const session = await peekBindSession(pollId);
  if (!session) return false;
  const written = await redis.eval(
    SETTLE_IF_OPEN_SCRIPT,
    1,
    sessionKey(pollId),
    JSON.stringify({ ...session, result }),
    result.status,
    SETTLED_TTL_SECONDS,
  );
  return written === 1;
};

/** A pending OAuth bind expires with the link TTL even though the record lives on. */
export const isBindSessionExpired = (session: BindSession, now = Date.now()): boolean =>
  session.result.status === 'pending' &&
  now - session.createdAt > getMessengerLinkTokenTtl() * 1000;
