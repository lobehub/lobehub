// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settleBindSession } from './sessionStore';

const redis = vi.hoisted(() => ({ eval: vi.fn(), get: vi.fn() }));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redis,
}));
vi.mock('@/config/messenger', () => ({ getMessengerLinkTokenTtl: () => 1800 }));

const pending = {
  agentId: 'agent-1',
  createdAt: 0,
  kind: 'oauth',
  platform: 'slack',
  pollId: 'poll-1',
  result: { status: 'pending' },
  userId: 'user-1',
  workspaceId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue(JSON.stringify(pending));
});

describe('settleBindSession', () => {
  it('writes through a compare-and-set script keyed on the pending result', async () => {
    redis.eval.mockResolvedValue(1);
    const result = { linkedAt: 1, platformUserId: 'U1', status: 'linked' } as const;

    await expect(settleBindSession('poll-1', result)).resolves.toBe(true);

    const [script, keyCount, key, value, status, ttl] = redis.eval.mock.calls[0];
    expect(script).toContain("status == 'pending'");
    expect(script).toContain("ARGV[2] == 'linked' and status == 'failed'");
    expect(keyCount).toBe(1);
    expect(key).toBe('messenger:bind-session:poll-1');
    expect(JSON.parse(value)).toEqual({ ...pending, result });
    expect(status).toBe('linked');
    expect(ttl).toBe(24 * 60 * 60);
  });

  it('reports a lost race when another outcome already settled the bind', async () => {
    redis.eval.mockResolvedValue(0);

    await expect(
      settleBindSession('poll-1', { reason: 'oauth_failed', status: 'failed' }),
    ).resolves.toBe(false);
  });

  it('does nothing for an unknown bind', async () => {
    redis.get.mockResolvedValue(null);

    await expect(
      settleBindSession('missing', { reason: 'oauth_failed', status: 'failed' }),
    ).resolves.toBe(false);
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
