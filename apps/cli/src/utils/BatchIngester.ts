import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

/**
 * Server verdict on one batch. `accepted: false` means the server took the
 * batch and threw it away — the operation is over on its side — so the events
 * are lost for good and retrying cannot help.
 */
export interface IngestAck {
  accepted: boolean;
  reason?: string;
}

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
  ingest: (events: AgentStreamEvent[]) => Promise<IngestAck>;
}

export class NoopIngestSink implements IngestSink {
  async finish(_params: Parameters<IngestSink['finish']>[0]): Promise<void> {}
  async ingest(_events: AgentStreamEvent[]): Promise<IngestAck> {
    return { accepted: true };
  }
}

const MAX_BATCH = 50;
const FLUSH_INTERVAL_MS = 250;
const MAX_RETRIES = 5;

/** The server acknowledged a batch and discarded it — see {@link IngestAck}. */
export class IngestRejectedError extends Error {
  constructor(readonly reason?: string) {
    super(
      `Server discarded the agent's output${reason ? ` (${reason})` : ''}: this run is no longer the topic's active operation, so nothing it produced was saved`,
    );
    this.name = 'IngestRejectedError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sends ordered event batches with bounded retries. A temporary outage leaves
 * the failed batch at the front of the queue; a later push or drain retries it
 * before any newer event. The buffer is byte-limited, so an extended outage
 * fails closed instead of retaining an unbounded native-agent transcript.
 */
export class BatchIngester {
  private buffer: { event: AgentStreamEvent; size: number }[] = [];
  private bufferedBytes = 0;
  private fatalError: Error | null = null;
  private lastSendError: Error | null = null;
  private pumping = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private worker: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: IngestSink,
    private readonly maxBufferedBytes = 16 * 1024 * 1024,
  ) {}

  /** Only a lost/overflowed stream is permanent; a transport outage can recover. */
  get failed(): boolean {
    return this.fatalError !== null;
  }

  push(event: AgentStreamEvent): void {
    if (this.fatalError) return;
    const size = Buffer.byteLength(JSON.stringify(event));
    if (this.bufferedBytes + size > this.maxBufferedBytes) {
      this.fatalError = new Error('Agent event buffer limit exceeded while waiting for upload');
      this.buffer = [];
      this.bufferedBytes = 0;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    this.buffer.push({ event, size });
    this.bufferedBytes += size;
    if (this.pumping) return;
    if (this.buffer.length >= MAX_BATCH) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.startPump();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.startPump();
      }, FLUSH_INTERVAL_MS);
    }
  }

  /** A failed final drain still prevents the caller from reporting success. */
  async drain(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.startPump();
    await this.worker;
    if (this.fatalError) throw this.fatalError;
    if (this.lastSendError) throw this.lastSendError;
  }

  private startPump(): void {
    if (this.pumping || this.fatalError || this.buffer.length === 0) return;
    this.lastSendError = null;
    this.pumping = true;
    this.worker = this.pump();
  }

  private async pump(): Promise<void> {
    try {
      while (!this.fatalError && this.buffer.length > 0) {
        // Remove only acknowledged events. A failed or partially acknowledged
        // batch must be redelivered before the events queued behind it.
        const batch = this.buffer.slice(0, MAX_BATCH);
        await this.sendWithRetry(batch.map(({ event }) => event));
        if (this.fatalError) break;
        this.buffer.splice(0, batch.length);
        this.bufferedBytes -= batch.reduce((total, item) => total + item.size, 0);
      }
    } catch (error) {
      this.lastSendError = error instanceof Error ? error : new Error(String(error));
    } finally {
      this.pumping = false;
    }
  }

  private async sendWithRetry(batch: AgentStreamEvent[]): Promise<void> {
    let delay = 500;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (this.fatalError) throw this.fatalError;
      try {
        const ack = await this.sink.ingest(batch);
        // A refusal is terminal, not transport noise: the server has closed the
        // operation and will discard every later batch the same way. Fail the
        // stream instead of retrying, so the run stops buffering and reports the
        // loss at `drain()` rather than exiting 0 on output nobody stored.
        if (ack && ack.accepted === false) {
          throw new IngestRejectedError(ack.reason);
        }
        return;
      } catch (error) {
        if (error instanceof IngestRejectedError) {
          this.fatalError = error;
          throw error;
        }
        if (attempt === MAX_RETRIES) throw error;
        await sleep(delay);
        delay = Math.min(delay * 2, 8_000);
      }
    }
  }
}
