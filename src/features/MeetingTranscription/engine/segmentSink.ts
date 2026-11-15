import type { LiveSegment } from './types';
import { retryDelay } from './types';

export interface SegmentSinkDependencies {
  /** Store the batch as realtime segments; must be idempotent per `seq`. */
  save: (segments: LiveSegment[]) => Promise<void>;
}

const MAX_BATCH = 100;

/**
 * Persists live segments in order. A failed save is retried with backoff and
 * the batch is re-sent as is; since rows are keyed by `seq`, a save that
 * succeeded but lost its response is overwritten, not duplicated.
 */
export class SegmentSink {
  readonly #deps: SegmentSinkDependencies;
  readonly #pending: LiveSegment[] = [];
  #attempt = 0;
  #disposed = false;
  #flushWaiters = new Set<() => void>();
  #saving = false;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(deps: SegmentSinkDependencies) {
    this.#deps = deps;
  }

  get pendingCount() {
    return this.#pending.length;
  }

  push(segments: LiveSegment[]) {
    if (this.#disposed || segments.length === 0) return;
    this.#pending.push(...segments);
    void this.#save();
  }

  /** Resolve once everything pushed so far is stored, or `false` after `timeoutMs`. */
  flush(timeoutMs: number) {
    if (this.#pending.length === 0 && !this.#saving) return Promise.resolve(true);

    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      void this.#save();
    }

    return new Promise<boolean>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.#flushWaiters.delete(done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.#flushWaiters.delete(done);
        resolve(false);
      }, timeoutMs);
      this.#flushWaiters.add(done);
    });
  }

  dispose() {
    this.#disposed = true;
    if (this.#timer) clearTimeout(this.#timer);
  }

  async #save() {
    if (this.#saving || this.#timer || this.#disposed || this.#pending.length === 0) return;

    this.#saving = true;
    const batch = this.#pending.slice(0, MAX_BATCH);
    try {
      await this.#deps.save(batch);
      this.#pending.splice(0, batch.length);
      this.#attempt = 0;
    } catch {
      const delay = retryDelay(this.#attempt++);
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.#save();
      }, delay);
    } finally {
      this.#saving = false;
    }

    if (this.#pending.length === 0) {
      for (const waiter of this.#flushWaiters) waiter();
    } else if (!this.#timer) {
      void this.#save();
    }
  }
}
