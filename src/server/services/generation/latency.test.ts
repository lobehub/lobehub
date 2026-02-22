import { describe, expect, it, vi } from 'vitest';

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
const { getVideoAvgLatency } = await import('./latency');
const { getServerDB } = await import('@/database/server');
const { isRedisEnabled, initializeRedis } = await import('@/libs/redis');

function createMockDB(rows: { latency: number | null }[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin2 = vi.fn().mockReturnValue({ where });
  const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
  const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
  const select = vi.fn().mockReturnValue({ from });

  return { select, from, innerJoin1, innerJoin2, where, orderBy } as const;
}

describe('getVideoAvgLatency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRedisEnabled).mockReturnValue(false);
  });

  it('should return null when no samples exist', async () => {
    const db = createMockDB([]);
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const result = await getVideoAvgLatency('test-model');

    expect(result).toBeNull();
  });

  it('should return simple average when fewer than 5 samples', async () => {
    const db = createMockDB([
      { latency: 100_000 },
      { latency: 120_000 },
      { latency: 140_000 },
    ]);
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const result = await getVideoAvgLatency('test-model');

    // (100000 + 120000 + 140000) / 3 = 120000
    expect(result).toBe(120_000);
  });

  it('should return trimmed mean when 5 or more samples', async () => {
    // 10 samples, sorted ascending (DB returns sorted by duration)
    const db = createMockDB([
      { latency: 10_000 }, // trimmed (bottom 10%)
      { latency: 50_000 },
      { latency: 60_000 },
      { latency: 70_000 },
      { latency: 80_000 },
      { latency: 90_000 },
      { latency: 100_000 },
      { latency: 110_000 },
      { latency: 120_000 },
      { latency: 500_000 }, // trimmed (top 10%)
    ]);
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const result = await getVideoAvgLatency('test-model');

    // trimCount = floor(10 * 0.1) = 1, slice(1, 9)
    // [50000, 60000, 70000, 80000, 90000, 100000, 110000, 120000]
    // sum = 680000, avg = 85000
    expect(result).toBe(85_000);
  });

  it('should return exact value for single sample', async () => {
    const db = createMockDB([{ latency: 95_000 }]);
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const result = await getVideoAvgLatency('test-model');

    expect(result).toBe(95_000);
  });

  it('should return trimmed mean for exactly 5 samples', async () => {
    const db = createMockDB([
      { latency: 10_000 },
      { latency: 20_000 },
      { latency: 30_000 },
      { latency: 40_000 },
      { latency: 50_000 },
    ]);
    vi.mocked(getServerDB).mockResolvedValue(db as any);

    const result = await getVideoAvgLatency('test-model');

    // trimCount = floor(5 * 0.1) = 0, no trimming
    // all 5 samples averaged: (10000+20000+30000+40000+50000)/5 = 30000
    expect(result).toBe(30_000);
  });

  describe('Redis caching', () => {
    it('should return cached value from Redis', async () => {
      const mockRedis = { get: vi.fn().mockResolvedValue('120000'), set: vi.fn() };
      vi.mocked(isRedisEnabled).mockReturnValue(true);
      vi.mocked(initializeRedis).mockResolvedValue(mockRedis as any);

      const result = await getVideoAvgLatency('test-model');

      expect(result).toBe(120_000);
      expect(mockRedis.get).toHaveBeenCalledWith('video:avg_latency:test-model');
    });

    it('should return null when cached value is "null"', async () => {
      const mockRedis = { get: vi.fn().mockResolvedValue('null'), set: vi.fn() };
      vi.mocked(isRedisEnabled).mockReturnValue(true);
      vi.mocked(initializeRedis).mockResolvedValue(mockRedis as any);

      const result = await getVideoAvgLatency('test-model');

      expect(result).toBeNull();
    });

    it('should query DB and write cache on cache miss', async () => {
      const mockRedis = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
      vi.mocked(isRedisEnabled).mockReturnValue(true);
      vi.mocked(initializeRedis).mockResolvedValue(mockRedis as any);

      const db = createMockDB([{ latency: 100_000 }, { latency: 200_000 }]);
      vi.mocked(getServerDB).mockResolvedValue(db as any);

      const result = await getVideoAvgLatency('test-model');

      expect(result).toBe(150_000);
      expect(mockRedis.set).toHaveBeenCalledWith('video:avg_latency:test-model', '150000', {
        ex: 300,
      });
    });

    it('should cache null result when no DB data', async () => {
      const mockRedis = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
      vi.mocked(isRedisEnabled).mockReturnValue(true);
      vi.mocked(initializeRedis).mockResolvedValue(mockRedis as any);

      const db = createMockDB([]);
      vi.mocked(getServerDB).mockResolvedValue(db as any);

      const result = await getVideoAvgLatency('test-model');

      expect(result).toBeNull();
      expect(mockRedis.set).toHaveBeenCalledWith('video:avg_latency:test-model', 'null', {
        ex: 300,
      });
    });

    it('should fall through to DB when Redis is unavailable', async () => {
      vi.mocked(isRedisEnabled).mockReturnValue(true);
      vi.mocked(initializeRedis).mockRejectedValue(new Error('Connection refused'));

      const db = createMockDB([{ latency: 80_000 }]);
      vi.mocked(getServerDB).mockResolvedValue(db as any);

      const result = await getVideoAvgLatency('test-model');

      expect(result).toBe(80_000);
    });

    it('should fall through when Redis get throws', async () => {
      const mockRedis = {
        get: vi.fn().mockRejectedValue(new Error('Redis error')),
        set: vi.fn(),
      };
      vi.mocked(isRedisEnabled).mockReturnValue(true);
      vi.mocked(initializeRedis).mockResolvedValue(mockRedis as any);

      const db = createMockDB([{ latency: 90_000 }]);
      vi.mocked(getServerDB).mockResolvedValue(db as any);

      const result = await getVideoAvgLatency('test-model');

      expect(result).toBe(90_000);
    });
  });
});
