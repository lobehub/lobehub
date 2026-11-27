import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('lobechat');

/** Long enough that reopening an old conversation still finds its record. */
const TTL_SECONDS = 30 * 24 * 60 * 60;

const FIELDS = ['activeAt', 'aliveAt', 'keepAliveUntil', 'recycledAt'] as const;
type Field = (typeof FIELDS)[number];

/**
 * What LobeHub has seen of one conversation's temporary sandbox. The execution
 * plane offers no way to ask whether a session is still alive without starting
 * a new one, so this is the only record that can answer "was it recycled?"
 * without spending a sandbox on the question.
 *
 * - `activeAt` — the agent last used it (and so it holds the agent's files);
 * - `aliveAt` — any call last reached it without the session being recreated;
 * - `keepAliveUntil` — the execution plane holds it past its idle window until
 *   then, because a long-running agent was started in it;
 * - `recycledAt` — a read found the session recreated, so what the agent wrote
 *   is gone until the agent works there again.
 */
export interface EphemeralSandboxActivity {
  activeAt?: number;
  aliveAt?: number;
  keepAliveUntil?: number;
  recycledAt?: number;
}

const keyOf = (userId: string, topicId: string) =>
  RedisKeys.lobechat.ephemeralSandbox(userId, topicId);

const stamp = async (userId: string, topicId: string, values: Partial<Record<Field, number>>) => {
  const redis = await getClient();
  if (!redis) return;

  const key = keyOf(userId, topicId);
  const pipeline = redis.pipeline();
  for (const [field, value] of Object.entries(values)) pipeline.hset(key, field, String(value));
  pipeline.expire(key, TTL_SECONDS);
  // Thrown to the caller, which logs it: a lost stamp makes a live sandbox
  // read as "not started" or "recycled", and that has to be traceable.
  await pipeline.exec();
};

export const ephemeralSandbox = {
  /**
   * The record for one user's conversation. `undefined` without Redis — the
   * caller cannot tell then and has to ask the sandbox itself; `null` when
   * nothing was ever recorded.
   */
  async read(
    userId: string,
    topicId: string,
  ): Promise<EphemeralSandboxActivity | null | undefined> {
    const redis = await getClient();
    if (!redis) return undefined;

    const raw = await redis.hgetall(keyOf(userId, topicId)).catch(() => undefined);
    if (raw === undefined) return undefined;

    const record: EphemeralSandboxActivity = {};
    for (const field of FIELDS) {
      const value = Number(raw?.[field]);
      if (Number.isFinite(value) && value > 0) record[field] = value;
    }

    return Object.keys(record).length > 0 ? record : null;
  },

  /**
   * The agent's run used the sandbox: its files are there now. `keepAliveUntil`
   * when the call started an agent the execution plane keeps the sandbox alive
   * for, which then works there without calling back through here.
   */
  recordAgentActivity: (
    userId: string,
    topicId: string,
    { keepAliveUntil }: { keepAliveUntil?: number } = {},
  ) => {
    const now = Date.now();
    return stamp(userId, topicId, {
      activeAt: now,
      aliveAt: now,
      ...(keepAliveUntil && { keepAliveUntil }),
    });
  },

  /** A read reached the sandbox the agent last used. */
  recordAlive: (userId: string, topicId: string) => stamp(userId, topicId, { aliveAt: Date.now() }),

  /** A read found a fresh sandbox in place of the agent's. */
  recordRecycled: (userId: string, topicId: string) =>
    stamp(userId, topicId, { recycledAt: Date.now() }),
};
