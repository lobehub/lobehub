import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

export interface IngestSink {
  finish: (params: {
    error?: {
      /**
       * Structured status-guide error (`classifyHeteroProcessFailure` output:
       * `agentType` + `code` + details). Persisted verbatim as the
       * `ChatMessageError.body` so the client renders the dedicated
       * install/sign-in guide instead of the generic error card.
       */
      body?: Record<string, unknown>;
      message: string;
      type: string;
    };
    result: 'cancelled' | 'error' | 'success';
    sessionId?: string;
  }) => Promise<void>;
  ingest: (events: AgentStreamEvent[]) => Promise<void>;
}

export class NoopIngestSink implements IngestSink {
  async finish(_params: Parameters<IngestSink['finish']>[0]): Promise<void> {}
  async ingest(_events: AgentStreamEvent[]): Promise<void> {}
}

const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 250;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Buffers `AgentStreamEvent`s and flushes them in batches to an `IngestSink`.
 *
 * A single send worker pumps the buffer: it splices at most MAX_BATCH (50)
 * events **at send time** — not when a flush is scheduled — so everything
 * that arrives while a slow request is in flight coalesces into the next
 * batch instead of fragmenting into per-interval micro-batches queued behind
 * it. Consumption per round-trip therefore scales with the backlog, which is
 * what lets ingest catch up to a producer that briefly outpaces the server.
 *
 * Pump triggers:
 *   - Buffer reaches MAX_BATCH (50) → start the worker immediately
 *   - FLUSH_INTERVAL_MS (250ms) timer fires → start the worker
 *   - drain() → start the worker and await it
 *
 * Each batch is retried up to MAX_RETRIES (5) times with exponential back-off
 * starting at 500ms, doubling up to 8s. After the final retry the error is
 * stored, the worker stops, and every event still buffered (or pushed later)
 * is dropped — later batches must never be sent once an earlier one is
 * permanently lost, or the server would see a gapped stream (a `tool_end`
 * whose `tool_start` never arrived). `drain()` rethrows the stored error,
 * allowing the caller to call `sink.finish({ result: 'error' })` and exit(1).
 *
 * Call order: push() repeatedly → drain() once (before finish()).
 */
export class BatchIngester {
  private buffer: AgentStreamEvent[] = [];
  private fatalError: Error | null = null;
  private pumping = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private worker: Promise<void> = Promise.resolve();

  constructor(private readonly sink: IngestSink) {}

  /** True once a batch has exhausted its retries — every later push is a no-op
   *  and `drain()` rethrows the stored error. Lets wrappers stop buffering
   *  work (e.g. text coalescing) that can never be delivered. */
  get failed(): boolean {
    return this.fatalError !== null;
  }

  push(event: AgentStreamEvent): void {
    if (this.fatalError) return;
    this.buffer.push(event);
    if (this.pumping) return; // the worker picks the event up after its current send
    if (this.buffer.length >= MAX_BATCH) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.startPump();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.startPump();
      }, FLUSH_INTERVAL_MS);
    }
  }

  /** Flush remaining buffer and wait for the worker to settle. */
  async drain(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.startPump();
    await this.worker;
    if (this.fatalError) throw this.fatalError;
  }

  private startPump(): void {
    if (this.pumping || this.fatalError || this.buffer.length === 0) return;
    this.pumping = true;
    this.worker = this.pump();
  }

  /**
   * Single-worker send loop. The batch is spliced right before each send, so
   * the buffer keeps growing while a request is in flight and the backlog
   * ships as few large batches. A fatal error (retries exhausted) breaks the
   * loop with the remaining buffer unsent — dropped, never gapped.
   */
  private async pump(): Promise<void> {
    try {
      while (!this.fatalError && this.buffer.length > 0) {
        const batch = this.buffer.splice(0, MAX_BATCH);
        await this.sendWithRetry(batch);
      }
    } catch {
      // fatalError is already set; drain() re-throws it.
    } finally {
      this.pumping = false;
    }
  }

  private async sendWithRetry(batch: AgentStreamEvent[]): Promise<void> {
    let delay = 500;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.sink.ingest(batch);
        return;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          this.fatalError = err instanceof Error ? err : new Error(String(err));
          throw this.fatalError;
        }
        await sleep(delay);
        delay = Math.min(delay * 2, 8_000);
      }
    }
  }
}
