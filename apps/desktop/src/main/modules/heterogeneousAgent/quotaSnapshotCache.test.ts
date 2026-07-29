import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQuotaCacheKey, QuotaSnapshotCache } from './quotaSnapshotCache';

interface TestQuotaSnapshot {
  error: string | null;
  session: number | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
}

const NOW = new Date('2026-07-14T12:00:00Z').getTime();

const snapshot = (overrides: Partial<TestQuotaSnapshot> = {}): TestQuotaSnapshot => ({
  error: null,
  session: 10,
  status: 'ok',
  updatedAt: Date.now(),
  ...overrides,
});

describe('QuotaSnapshotCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates stable source keys without exposing environment values', () => {
    const left = createQuotaCacheKey('claude-code', {
      CLAUDE_CONFIG_DIR: '/profile',
      SECRET_TOKEN: 'sensitive-value',
    });
    const right = createQuotaCacheKey('claude-code', {
      SECRET_TOKEN: 'sensitive-value',
      CLAUDE_CONFIG_DIR: '/profile',
    });

    expect(left).toBe(right);
    expect(left).not.toContain('sensitive-value');
    expect(createQuotaCacheKey('claude-code', { CLAUDE_CONFIG_DIR: '/other' })).not.toBe(left);
  });

  it('coalesces concurrent reads and reuses a fresh automatic snapshot', async () => {
    const cache = new QuotaSnapshotCache<TestQuotaSnapshot>();
    let resolveRequest: ((value: TestQuotaSnapshot) => void) | undefined;
    const fetchSnapshot = vi.fn(
      () =>
        new Promise<TestQuotaSnapshot>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const first = cache.get('source', fetchSnapshot);
    const second = cache.get('source', fetchSnapshot);

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    resolveRequest?.(snapshot());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    await expect(cache.get('source', fetchSnapshot)).resolves.toMatchObject({ status: 'ok' });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('lets an explicit refresh bypass freshness', async () => {
    const cache = new QuotaSnapshotCache<TestQuotaSnapshot>();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot());

    await cache.get('source', fetchSnapshot);
    await cache.get('source', fetchSnapshot, { force: true });

    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('starts a new read after invalidating an in-flight entry', async () => {
    const cache = new QuotaSnapshotCache<TestQuotaSnapshot>();
    const requests: Array<(value: TestQuotaSnapshot) => void> = [];
    const fetchSnapshot = vi.fn(
      () =>
        new Promise<TestQuotaSnapshot>((resolve) => {
          requests.push(resolve);
        }),
    );

    const staleRequest = cache.get('source', fetchSnapshot);
    cache.invalidate('source');
    const freshRequest = cache.get('source', fetchSnapshot);

    expect(fetchSnapshot).toHaveBeenCalledTimes(2);

    requests[1](snapshot({ session: 90 }));
    await expect(freshRequest).resolves.toMatchObject({ session: 90 });

    requests[0](snapshot({ session: 10 }));
    await expect(staleRequest).resolves.toMatchObject({ session: 10 });

    await expect(cache.get('source', fetchSnapshot)).resolves.toMatchObject({ session: 90 });
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('evicts entries after their inactivity TTL expires', async () => {
    const cache = new QuotaSnapshotCache<TestQuotaSnapshot>({
      entryTtlMs: 1_000,
      freshMs: 10_000,
    });
    const fetchSnapshot = vi.fn(async () => snapshot());

    await cache.get('source', fetchSnapshot);
    vi.advanceTimersByTime(1_001);
    await cache.get('source', fetchSnapshot);

    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('keeps expired entries while in flight and evicts them after they settle', async () => {
    const cache = new QuotaSnapshotCache<TestQuotaSnapshot>({ entryTtlMs: 1_000 });
    let resolveRequest: ((value: TestQuotaSnapshot) => void) | undefined;
    const fetchSnapshot = vi
      .fn<() => Promise<TestQuotaSnapshot>>()
      .mockImplementationOnce(
        () =>
          new Promise<TestQuotaSnapshot>((resolve) => {
            resolveRequest = resolve;
          }),
      )
      .mockImplementation(async () => snapshot());
    const fetchOtherSnapshot = vi.fn(async () => snapshot());

    const first = cache.get('source', fetchSnapshot);
    vi.advanceTimersByTime(1_001);
    await cache.get('other', fetchOtherSnapshot);

    const joined = cache.get('source', fetchSnapshot);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_001);
    await cache.get('another', fetchOtherSnapshot);
    resolveRequest?.(snapshot());
    await Promise.all([first, joined]);

    await cache.get('source', fetchSnapshot);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('keeps recent successful data during an error cooldown', async () => {
    const cache = new QuotaSnapshotCache<TestQuotaSnapshot>();
    const fetchSnapshot = vi
      .fn<() => Promise<TestQuotaSnapshot>>()
      .mockResolvedValueOnce(snapshot({ session: 25 }))
      .mockResolvedValueOnce(
        snapshot({ error: 'upstream returned 429', session: null, status: 'error' }),
      );

    const successful = await cache.get('source', fetchSnapshot);
    vi.advanceTimersByTime(5 * 60_000);
    const stale = await cache.get('source', fetchSnapshot);

    expect(stale).toEqual({
      ...successful,
      error: 'upstream returned 429',
      status: 'error',
    });

    await expect(cache.get('source', fetchSnapshot)).resolves.toEqual(stale);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });
});
