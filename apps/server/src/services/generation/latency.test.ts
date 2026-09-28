import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('@/libs/redis', () => ({
  isRedisEnabled: vi.fn().mockReturnValue(false),
  initializeRedis: vi.fn(),
}));

// Must import after vi.mock declarations
const { getVideoAvgLatencies, getVideoLatencyKey } = await import('./latency');
const { getServerDB } = await import('@/database/server');
const { isRedisEnabled, initializeRedis } = await import('@/libs/redis');

interface LatencyRow {
  latency: number | null;
  model: string;
  provider: string;
}

const MODEL = { model: 'test-model', provider: 'provider-1' };
const MODEL_KEY = getVideoLatencyKey(MODEL);
const CACHE_KEY = 'video:avg_latency:provider-1:test-model';

const samples = (latencies: number[], ref = MODEL): LatencyRow[] =>
  latencies.map((latency) => ({ latency, ...ref }));

function createMockDB(rows: LatencyRow[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin2 = vi.fn().mockReturnValue({ where });
  const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
  const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
  const select = vi.fn().mockReturnValue({ from });

  return { select, from, innerJoin1, innerJoin2, where, orderBy } as const;
}

const mockDB = (rows: LatencyRow[]) => {
  const db = createMockDB(rows);
  vi.mocked(getServerDB).mockResolvedValue(db as any);
  return db;
};

const mockRedis = (redis: Record<string, unknown>) => {
  vi.mocked(isRedisEnabled).mockReturnValue(true);
  vi.mocked(initializeRedis).mockResolvedValue(redis as any);
};

describe('getVideoAvgLatencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRedisEnabled).mockReturnValue(false);
  });

  it('should return an empty map without querying when no models are requested', async () => {
    const result = await getVideoAvgLatencies([]);

    expect(result.size).toBe(0);
    expect(getServerDB).not.toHaveBeenCalled();
  });

  it('should return null when no samples exist', async () => {
    mockDB([]);

    const result = await getVideoAvgLatencies([MODEL]);

    expect(result.get(MODEL_KEY)).toBeNull();
  });

  it('should return simple average when fewer than 5 samples', async () => {
    mockDB(samples([100_000, 120_000, 140_000]));

    const result = await getVideoAvgLatencies([MODEL]);

    expect(result.get(MODEL_KEY)).toBe(120_000);
  });

  it('should return trimmed mean when 5 or more samples', async () => {
    // 10 samples, sorted ascending (DB returns sorted by duration); top/bottom one are trimmed
    mockDB(
      samples([10_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 500_000]),
    );

    const result = await getVideoAvgLatencies([MODEL]);

    // [50000..120000] sum = 680000, avg = 85000
    expect(result.get(MODEL_KEY)).toBe(85_000);
  });

  it('should not trim exactly 5 samples', async () => {
    mockDB(samples([10_000, 20_000, 30_000, 40_000, 50_000]));

    const result = await getVideoAvgLatencies([MODEL]);

    expect(result.get(MODEL_KEY)).toBe(30_000);
  });

  it('should resolve several models with one query and keep them provider-scoped', async () => {
    const sameModelOtherProvider = { model: 'test-model', provider: 'provider-2' };
    const otherModel = { model: 'other-model', provider: 'provider-1' };
    const db = mockDB([
      ...samples([60_000], sameModelOtherProvider),
      ...samples([100_000, 200_000]),
    ]);

    const result = await getVideoAvgLatencies([MODEL, MODEL, sameModelOtherProvider, otherModel]);

    expect(db.select).toHaveBeenCalledOnce();
    expect(result.get(MODEL_KEY)).toBe(150_000);
    expect(result.get(getVideoLatencyKey(sameModelOtherProvider))).toBe(60_000);
    expect(result.get(getVideoLatencyKey(otherModel))).toBeNull();
    expect(result.size).toBe(3);
  });

  it('should return null and log the affected models when the query fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getServerDB).mockRejectedValue(new Error('DB timeout'));

    const result = await getVideoAvgLatencies([MODEL]);

    expect(result.get(MODEL_KEY)).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load average latency'),
      'provider-1/test-model',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  describe('Redis caching', () => {
    it('should return cached values without querying the database', async () => {
      mockRedis({ mget: vi.fn().mockResolvedValue(['120000']), set: vi.fn() });

      const result = await getVideoAvgLatencies([MODEL]);

      expect(result.get(MODEL_KEY)).toBe(120_000);
      expect(getServerDB).not.toHaveBeenCalled();
    });

    it('should treat a cached "null" as a known empty result', async () => {
      mockRedis({ mget: vi.fn().mockResolvedValue(['null']), set: vi.fn() });

      const result = await getVideoAvgLatencies([MODEL]);

      expect(result.get(MODEL_KEY)).toBeNull();
      expect(getServerDB).not.toHaveBeenCalled();
    });

    it('should query only cache misses and write them back', async () => {
      const cachedModel = { model: 'cached-model', provider: 'provider-1' };
      const redis = { mget: vi.fn().mockResolvedValue(['90000', null]), set: vi.fn() };
      mockRedis(redis);
      mockDB(samples([100_000, 200_000]));

      const result = await getVideoAvgLatencies([cachedModel, MODEL]);

      expect(redis.mget).toHaveBeenCalledWith(
        'video:avg_latency:provider-1:cached-model',
        CACHE_KEY,
      );
      expect(result.get(getVideoLatencyKey(cachedModel))).toBe(90_000);
      expect(result.get(MODEL_KEY)).toBe(150_000);
      expect(redis.set).toHaveBeenCalledOnce();
      expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, '150000', { ex: 300 });
    });

    it('should cache a null result when no DB data exists', async () => {
      const redis = { mget: vi.fn().mockResolvedValue([null]), set: vi.fn() };
      mockRedis(redis);
      mockDB([]);

      const result = await getVideoAvgLatencies([MODEL]);

      expect(result.get(MODEL_KEY)).toBeNull();
      expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, 'null', { ex: 300 });
    });

    it('should fall through to DB when Redis is unavailable', async () => {
      vi.mocked(isRedisEnabled).mockReturnValue(true);
      vi.mocked(initializeRedis).mockRejectedValue(new Error('Connection refused'));
      mockDB(samples([80_000]));

      const result = await getVideoAvgLatencies([MODEL]);

      expect(result.get(MODEL_KEY)).toBe(80_000);
    });

    it('should fall through to DB when Redis mget throws', async () => {
      mockRedis({ mget: vi.fn().mockRejectedValue(new Error('Redis error')), set: vi.fn() });
      mockDB(samples([90_000]));

      const result = await getVideoAvgLatencies([MODEL]);

      expect(result.get(MODEL_KEY)).toBe(90_000);
    });
  });
});
