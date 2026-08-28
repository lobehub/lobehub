interface ExpiringEntry<T> {
  expiresAt: number;
  value: T;
}

const MAX_SWEEP_INTERVAL_MS = 60_000;

/**
 * Small process-local TTL map with one unref'ed cleanup timer.
 *
 * The bounded sweep interval prevents unique, never-read keys from accumulating
 * indefinitely while avoiding one timer per Agent Signal entry.
 */
export class ExpiringMap<T> {
  private entries = new Map<string, ExpiringEntry<T>>();
  private nextSweepAt?: number;
  private sweepTimer?: ReturnType<typeof setTimeout>;

  get size() {
    return this.entries.size;
  }

  clear() {
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.entries.clear();
    this.nextSweepAt = undefined;
    this.sweepTimer = undefined;
  }

  delete(key: string) {
    return this.entries.delete(key);
  }

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs: number) {
    const expiresAt = Date.now() + Math.max(0, ttlMs);
    this.entries.set(key, { expiresAt, value });

    if (this.nextSweepAt === undefined || expiresAt < this.nextSweepAt) {
      if (this.sweepTimer) clearTimeout(this.sweepTimer);
      this.scheduleSweep();
    }
  }

  private scheduleSweep() {
    if (this.entries.size === 0) return;

    const now = Date.now();
    const earliestExpiration = Math.min(
      ...Array.from(this.entries.values(), ({ expiresAt }) => expiresAt),
    );
    this.nextSweepAt = Math.min(earliestExpiration, now + MAX_SWEEP_INTERVAL_MS);
    this.sweepTimer = setTimeout(
      () => {
        this.nextSweepAt = undefined;
        this.sweepTimer = undefined;
        this.sweep();
        this.scheduleSweep();
      },
      Math.max(0, this.nextSweepAt - now),
    );
    this.sweepTimer.unref();
  }

  private sweep() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
