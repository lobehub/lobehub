import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/redis', () => ({
  getRedisConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('@/server/modules/Redis', () => ({
  getJSONFromRedis: vi.fn(),
  initializeRedisWithPrefix: vi.fn().mockResolvedValue({}),
  isRedisEnabled: vi.fn().mockReturnValue(true),
  RedisKeyNamespace: { AI_GENERATION: 'aiGeneration' },
  RedisKeys: { aiGeneration: { homeBrief: (userId: string) => `home_brief:${userId}` } },
}));

const { HomeService } = await import('./index');
const { getJSONFromRedis } = await import('@/server/modules/Redis');

const personalBrief = {
  pairs: [{ hint: 'Continue [pickleball paddles](/agent/agt_1/tpc_1)…', welcome: 'Hi' }],
};

describe('HomeService.getDailyBrief', () => {
  beforeEach(() => {
    vi.mocked(getJSONFromRedis).mockReset().mockResolvedValue(personalBrief);
  });

  it('returns the cached brief in personal scope', async () => {
    const service = new HomeService('user_1');

    await expect(service.getDailyBrief()).resolves.toEqual(personalBrief);
    expect(getJSONFromRedis).toHaveBeenCalledWith(expect.anything(), 'home_brief:user_1');
  });

  it('does not surface the personal brief inside a workspace', async () => {
    const service = new HomeService('user_1', 'ws_1');

    await expect(service.getDailyBrief()).resolves.toEqual({ pairs: [] });
    expect(getJSONFromRedis).not.toHaveBeenCalled();
  });

  it('returns empty pairs when the cached payload is malformed', async () => {
    vi.mocked(getJSONFromRedis).mockResolvedValue({ pairs: 'oops' });

    await expect(new HomeService('user_1').getDailyBrief()).resolves.toEqual({ pairs: [] });
  });
});
