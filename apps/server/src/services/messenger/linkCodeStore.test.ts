// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumeLinkCode,
  issueLinkCode,
  peekLinkCodeStatus,
  settleLinkCode,
} from './linkTokenStore';

vi.mock('@/config/messenger', () => ({
  getMessengerLinkTokenTtl: vi.fn().mockReturnValue(1800),
}));

/** Minimal ioredis stand-in: values + per-key TTL, enough for the code store. */
const fakeRedis = () => {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    client: {
      del: vi.fn(async (key: string) => {
        store.delete(key);
        ttls.delete(key);
        return 1;
      }),
      exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      getdel: vi.fn(async (key: string) => {
        const value = store.get(key) ?? null;
        store.delete(key);
        return value;
      }),
      set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
        if (args.includes('NX') && store.has(key)) return null;
        store.set(key, value);
        const exIndex = args.indexOf('EX');
        if (exIndex !== -1) ttls.set(key, args[exIndex + 1] as number);
        return 'OK';
      }),
      ttl: vi.fn(async (key: string) => (store.has(key) ? (ttls.get(key) ?? -1) : -2)),
    },
    store,
  };
};

let redisRef: ReturnType<typeof fakeRedis>;

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => redisRef.client),
}));

let seq = 0;
const mintCode = () => `LH-TESTCOD${++seq}`;

const issue = (userId = 'user_alice') =>
  issueLinkCode({
    activeAgentId: 'agt_inbox',
    mintCode,
    platform: 'linq',
    userId,
    workspaceId: null,
  });

beforeEach(() => {
  redisRef = fakeRedis();
  seq = 0;
});

describe('link codes', () => {
  it('issues a code, then hands it to exactly one consumer', async () => {
    const { code, pollId } = await issue();

    const first = await consumeLinkCode(code, 'linq');
    expect(first).toMatchObject({
      activeAgentId: 'agt_inbox',
      platform: 'linq',
      pollId,
      userId: 'user_alice',
    });

    // A replayed webhook, or a second phone sending the same code, gets nothing.
    expect(await consumeLinkCode(code, 'linq')).toBeNull();
  });

  it('matches a code typed in lower case', async () => {
    const { code } = await issue();
    expect(await consumeLinkCode(code.toLowerCase(), 'linq')).not.toBeNull();
  });

  it('reuses the live code for the same user instead of invalidating it', async () => {
    const first = await issue();
    const second = await issue();
    expect(second.code).toBe(first.code);
    expect(second.pollId).toBe(first.pollId);

    const other = await issue('user_bob');
    expect(other.code).not.toBe(first.code);
  });

  it('refuses a code issued for another platform', async () => {
    const { code } = await issue();
    expect(await consumeLinkCode(code, 'telegram')).toBeNull();
  });

  it('reports pending → linked to the issuing user only', async () => {
    const { code, pollId } = await issue();
    expect(await peekLinkCodeStatus(pollId, 'user_alice')).toEqual({ status: 'pending' });

    await consumeLinkCode(code, 'linq');
    await settleLinkCode(pollId, {
      linkedAt: 1,
      platformUserId: '+15550001111',
      status: 'linked',
    });

    expect(await peekLinkCodeStatus(pollId, 'user_alice')).toEqual({
      linkedAt: 1,
      platformUserId: '+15550001111',
      status: 'linked',
    });
    // Someone else's poll id reveals nothing.
    expect(await peekLinkCodeStatus(pollId, 'user_bob')).toEqual({ status: 'expired' });
  });

  it('reports expired once a pending code is gone', async () => {
    const { code, pollId } = await issue();
    redisRef.store.delete(`messenger:link-code:${code}`);
    expect(await peekLinkCodeStatus(pollId, 'user_alice')).toEqual({ status: 'expired' });
  });

  it('surfaces a failed link outcome to the polling page', async () => {
    const { pollId } = await issue();
    await settleLinkCode(pollId, { reason: 'already_linked_to_other', status: 'failed' });
    expect(await peekLinkCodeStatus(pollId, 'user_alice')).toEqual({
      reason: 'already_linked_to_other',
      status: 'failed',
    });
  });
});
