// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_SIGNAL_DEFAULTS } from '../../../../constants';
import { claimNightlyReviewTopics } from '../topicQuota';

const sets = new Map<string, Set<string>>();

const service = vi.hoisted(() => ({ available: true, claimNightlyTopics: vi.fn() }));

vi.mock('@/server/services/redis', () => ({
  redisService: { agentSignal: { claimNightlyTopics: service.claimNightlyTopics } },
}));

/**
 * Applies the domain's claim semantics to an in-memory set, the way Redis runs the Lua
 * atomically: ids already in the night's set are admitted for free, new ids only while
 * under the limit.
 */
const claimInMemory = async (scope: {
  limit: number;
  localDate: string;
  topicIds: string[];
  userId: string;
}) => {
  if (!service.available) return undefined;
  const key = `${scope.userId}:${scope.localDate}`;
  const set = sets.get(key) ?? new Set<string>();
  sets.set(key, set);
  const admitted: string[] = [];
  for (const id of scope.topicIds) {
    if (set.has(id)) admitted.push(id);
    else if (set.size < scope.limit) {
      set.add(id);
      admitted.push(id);
    }
  }
  return admitted;
};

const topics = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

describe('claimNightlyReviewTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sets.clear();
    service.available = true;
    service.claimNightlyTopics.mockImplementation(claimInMemory);
  });

  it('caps one user at 50 distinct topics per night across agents', async () => {
    expect(AGENT_SIGNAL_DEFAULTS.nightlyReviewTopicLimitPerUser).toBe(50);

    const first = await claimNightlyReviewTopics({
      localDate: '2026-10-11',
      topicIds: topics('agent-a', 30),
      userId: 'u1',
    });
    const second = await claimNightlyReviewTopics({
      localDate: '2026-10-11',
      topicIds: topics('agent-b', 30),
      userId: 'u1',
    });
    const third = await claimNightlyReviewTopics({
      localDate: '2026-10-11',
      topicIds: topics('agent-c', 5),
      userId: 'u1',
    });

    expect(first).toEqual({ admitted: topics('agent-a', 30) });
    expect(second).toEqual({ admitted: topics('agent-b', 20), reason: 'exhausted' });
    expect(third).toEqual({ admitted: [], reason: 'exhausted' });
    expect(service.claimNightlyTopics).toHaveBeenLastCalledWith({
      limit: 50,
      localDate: '2026-10-11',
      topicIds: topics('agent-c', 5),
      userId: 'u1',
    });
  });

  it('does not double-count topics on a replay or a second pass', async () => {
    const input = { localDate: '2026-10-11', topicIds: topics('t', 50), userId: 'u1' };

    await claimNightlyReviewTopics(input);
    const replay = await claimNightlyReviewTopics(input);

    expect(replay).toEqual({ admitted: topics('t', 50) });
  });

  it('keeps separate quotas per user and per night', async () => {
    await claimNightlyReviewTopics({
      localDate: '2026-10-11',
      topicIds: topics('t', 50),
      userId: 'u1',
    });

    await expect(
      claimNightlyReviewTopics({ localDate: '2026-10-12', topicIds: ['n'], userId: 'u1' }),
    ).resolves.toEqual({ admitted: ['n'] });
    await expect(
      claimNightlyReviewTopics({ localDate: '2026-10-11', topicIds: ['o'], userId: 'u2' }),
    ).resolves.toEqual({ admitted: ['o'] });
  });

  it('fails closed when Redis is not configured', async () => {
    service.available = false;

    await expect(
      claimNightlyReviewTopics({ localDate: '2026-10-11', topicIds: ['t'], userId: 'u1' }),
    ).resolves.toEqual({ admitted: [], reason: 'unavailable' });
  });

  it('fails closed without throwing when Redis errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.claimNightlyTopics.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      claimNightlyReviewTopics({ localDate: '2026-10-11', topicIds: ['t'], userId: 'u1' }),
    ).resolves.toEqual({ admitted: [], reason: 'unavailable' });
    consoleError.mockRestore();
  });
});
