import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

export interface IngestSink {
  finish: (params: {
    error?: { message: string; type: string };
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
 * Flush triggers:
 *   - Buffer reaches MAX_BATCH (50) → immediate flush
 *   - FLUSH_INTERVAL_MS (250ms) timer fires → flush whatever is buffered
 *
 * Each batch is retried up to MAX_RETRIES (5) times with exponential back-off
 * starting at 500ms, doubling up to 8s.  After the final retry the error is
 * stored and re-thrown by `drain()`, allowing the caller to call
 * `sink.finish({ result: 'error' })` and exit(1).
 *
 * Call order: push() repeatedly → drain() once (before finish()).
 */
export class BatchIngester {
  private buffer: AgentStreamEvent[] = [];
  private fatalError: Error | null = null;
  private inflightFlush: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly sink: IngestSink) {}

  push(event: AgentStreamEvent): void {
    if (this.fatalError) return;
    this.buffer.push(event);
    if (this.buffer.length >= MAX_BATCH) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.triggerFlush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.triggerFlush();
      }, FLUSH_INTERVAL_MS);
    }
  }

  /** Flush remaining buffer and wait for all in-flight sends to settle. */
  async drain(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.triggerFlush();
    await this.inflightFlush;
    if (this.fatalError) throw this.fatalError;
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

  private triggerFlush(): void {
    if (this.fatalError || this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.inflightFlush = this.inflightFlush
      .then(() => this.sendWithRetry(batch))
      .catch(() => {
        // fatalError is already set; drain() re-throws it
      });
  }
}
