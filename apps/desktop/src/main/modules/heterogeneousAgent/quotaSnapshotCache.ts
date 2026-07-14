import { createHash } from 'node:crypto';

const DEFAULT_ERROR_COOLDOWN_MS = 60_000;
const DEFAULT_ENTRY_TTL_MS = 30 * 60_000;
const DEFAULT_FRESH_MS = 5 * 60_000;
const DEFAULT_STALE_MS = 30 * 60_000;

interface CacheableQuotaSnapshot {
  error: string | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
}

interface QuotaSnapshotCacheEntry<S> {
  inFlight?: Promise<S>;
  lastAccessedAt: number;
  lastResult?: S;
  lastSuccessful?: S;
  retryAt: number;
}

export interface QuotaSnapshotCacheConfig {
  entryTtlMs?: number;
  errorCooldownMs?: number;
  freshMs?: number;
  staleMs?: number;
}

export interface GetQuotaSnapshotOptions {
  force?: boolean;
}

type QuotaSourcePart = Record<string, string | undefined> | string | null | undefined;

const normalizeQuotaSourcePart = (part: QuotaSourcePart) => {
  if (!part || typeof part === 'string') return part ?? null;

  return Object.entries(part)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
};

/**
 * Build a stable cache key without retaining auth tokens or other environment
 * values as plaintext Map keys in the long-lived desktop process.
 */
export const createQuotaCacheKey = (...parts: QuotaSourcePart[]) =>
  createHash('sha256')
    .update(JSON.stringify(parts.map((part) => normalizeQuotaSourcePart(part))))
    .digest('hex');

/**
 * Main-process quota cache shared by every renderer instance of one provider.
 * Automatic reads reuse recent data and transient failures enter a cooldown;
 * explicit refreshes bypass those timers while still joining an in-flight read.
 */
export class QuotaSnapshotCache<S extends CacheableQuotaSnapshot> {
  private readonly entries = new Map<string, QuotaSnapshotCacheEntry<S>>();
  private readonly entryTtlMs: number;
  private readonly errorCooldownMs: number;
  private readonly freshMs: number;
  private readonly staleMs: number;

  constructor(config: QuotaSnapshotCacheConfig = {}) {
    this.entryTtlMs = config.entryTtlMs ?? DEFAULT_ENTRY_TTL_MS;
    this.errorCooldownMs = config.errorCooldownMs ?? DEFAULT_ERROR_COOLDOWN_MS;
    this.freshMs = config.freshMs ?? DEFAULT_FRESH_MS;
    this.staleMs = config.staleMs ?? DEFAULT_STALE_MS;
  }

  async get(
    key: string,
    fetchSnapshot: () => Promise<S>,
    options: GetQuotaSnapshotOptions = {},
  ): Promise<S> {
    const now = Date.now();
    this.evictExpiredEntries(now);

    const entry = this.entries.get(key) ?? { lastAccessedAt: now, retryAt: 0 };
    entry.lastAccessedAt = now;
    this.entries.set(key, entry);

    if (entry.inFlight) return entry.inFlight;

    if (!options.force && entry.lastResult) {
      if (entry.retryAt > now) return entry.lastResult;

      if (entry.lastResult.status !== 'error' && now - entry.lastResult.updatedAt < this.freshMs) {
        return entry.lastResult;
      }
    }

    const request = this.fetchAndUpdate(entry, fetchSnapshot);
    entry.inFlight = request;

    try {
      return await request;
    } finally {
      if (entry.inFlight === request) delete entry.inFlight;
      this.evictExpiredEntries(Date.now());
    }
  }

  private evictExpiredEntries(now: number) {
    for (const [key, entry] of this.entries) {
      if (!entry.inFlight && now - entry.lastAccessedAt >= this.entryTtlMs) {
        this.entries.delete(key);
      }
    }
  }

  private async fetchAndUpdate(
    entry: QuotaSnapshotCacheEntry<S>,
    fetchSnapshot: () => Promise<S>,
  ): Promise<S> {
    const fresh = await fetchSnapshot();

    if (fresh.status === 'ok') {
      entry.lastResult = fresh;
      entry.lastSuccessful = fresh;
      entry.retryAt = 0;
      return fresh;
    }

    if (fresh.status === 'unavailable') {
      entry.lastResult = fresh;
      entry.lastSuccessful = undefined;
      entry.retryAt = 0;
      return fresh;
    }

    const now = Date.now();
    entry.retryAt = now + this.errorCooldownMs;
    const lastSuccessful = entry.lastSuccessful;

    if (lastSuccessful && now - lastSuccessful.updatedAt <= this.staleMs) {
      const staleResult = {
        ...lastSuccessful,
        error: fresh.error,
        status: 'error' as const,
      };
      entry.lastResult = staleResult;
      return staleResult;
    }

    entry.lastResult = fresh;
    return fresh;
  }
}
