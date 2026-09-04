import fs from 'node:fs/promises';
import path from 'node:path';

import { MAX_SYNC_BATCH, type MessageSyncOperation, type MessageSyncSink } from './messageSync';

const FLUSH_INTERVAL_MS = 250;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface MessageWriteQueueOptions {
  /** First retry delay; doubles up to {@link MAX_BACKOFF_MS}. Injectable so tests
   *  need not sit through the real schedule. */
  initialBackoffMs?: number;
  /**
   * Append-only log of operations not yet confirmed by the sink. Omit to run
   * without crash recovery (tests, or a run that tolerates losing its replica).
   */
  logPath?: string;
  maxRetries?: number;
  onError?: (message: string) => void;
  sink: MessageSyncSink;
}

/**
 * Write-behind replication of local messages to the cloud.
 *
 * The point is that `enqueue` returns immediately: the runtime has already
 * written to {@link LocalMessageStore} and read its own write back from
 * memory, so nothing in the agent loop waits on the network. Batches ship in
 * the background and the cloud becomes eventually consistent.
 *
 * Durability comes from the log rather than from blocking. Each operation is
 * appended as one JSON line before it is considered accepted; lines are only
 * dropped once the sink has confirmed them. A process killed mid-run therefore
 * leaves exactly the un-replicated operations on disk, and {@link recover}
 * replays them. Every operation carries the message id assigned locally, so a
 * replay that overlaps an already-delivered batch rewrites the same rows
 * instead of duplicating them.
 */
export class MessageWriteQueue {
  private buffer: MessageSyncOperation[] = [];
  private fatalError: Error | null = null;
  private pumping = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private worker: Promise<void> = Promise.resolve();
  /** Serializes log appends so concurrent enqueues cannot interleave a line. */
  private logWrites: Promise<void> = Promise.resolve();
  private logDegraded = false;

  constructor(private readonly options: MessageWriteQueueOptions) {}

  /** True once a batch has exhausted its retries; later operations are logged but not sent. */
  get failed(): boolean {
    return this.fatalError !== null;
  }

  /**
   * True once a log append has failed. Replication still runs, but a crash from
   * here on loses whatever has not yet been confirmed.
   */
  get degraded(): boolean {
    return this.logDegraded;
  }

  get pending(): number {
    return this.buffer.length;
  }

  /**
   * Record a mutation for eventual replication.
   *
   * Awaits the log append but never the network — the distinction is the whole
   * design. A local append costs microseconds; the network round trip this
   * exists to avoid costs hundreds of milliseconds. Returning before the record
   * is on disk would leave a window where an operation is neither sent nor
   * recoverable, which is the one thing a write-ahead log must not allow.
   */
  async enqueue(operation: MessageSyncOperation): Promise<void> {
    await this.appendToLog(operation);

    if (this.fatalError) return;
    this.buffer.push(operation);

    if (this.pumping) return;
    if (this.buffer.length >= MAX_SYNC_BATCH) {
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

  /** Flush everything buffered and wait for the sink to settle. */
  async drain(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.startPump();
    await this.worker;
    await this.logWrites;
    if (this.fatalError) throw this.fatalError;
  }

  /**
   * Replay operations a previous process logged but never confirmed.
   *
   * Called at start-up, before the run enqueues anything of its own, so the
   * replayed operations ship ahead of the new ones and the cloud sees them in
   * their original order.
   */
  async recover(): Promise<number> {
    const logPath = this.options.logPath;
    if (!logPath) return 0;

    const raw = await fs.readFile(logPath, 'utf8').catch(() => '');
    if (!raw.trim()) return 0;

    let recovered = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        this.buffer.push(JSON.parse(line) as MessageSyncOperation);
        recovered += 1;
      } catch {
        // A process killed mid-append leaves one truncated trailing line. The
        // operations before it are intact and still worth replaying, so skip
        // the fragment rather than discarding the whole log.
        this.warn('skipped a truncated entry in the write log');
      }
    }

    if (recovered > 0) this.startPump();
    return recovered;
  }

  private startPump(): void {
    if (this.pumping || this.fatalError || this.buffer.length === 0) return;
    this.pumping = true;
    this.worker = this.pump();
  }

  private async pump(): Promise<void> {
    try {
      while (!this.fatalError && this.buffer.length > 0) {
        // Spliced at send time, not when the flush was scheduled, so operations
        // arriving during a slow request coalesce into the next batch instead
        // of fragmenting into micro-batches queued behind it.
        const batch = this.buffer.splice(0, MAX_SYNC_BATCH);
        await this.send(batch);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async send(batch: MessageSyncOperation[]): Promise<void> {
    let backoff = this.options.initialBackoffMs ?? INITIAL_BACKOFF_MS;
    const maxRetries = this.options.maxRetries ?? MAX_RETRIES;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.options.sink.flush(batch);
        await this.confirm(batch.length);
        return;
      } catch (error) {
        // A batch replayed after a crash reaches a backend that already has
        // those rows. Retrying it can never succeed, and letting it exhaust the
        // retries would set `fatalError` and end replication for the whole run.
        if (this.options.sink.isAlreadyApplied?.(error)) {
          await this.confirm(batch.length);
          return;
        }
        if (attempt === maxRetries) {
          this.fatalError = error instanceof Error ? error : new Error(String(error));
          this.warn(`giving up on a batch of ${batch.length}: ${this.fatalError.message}`);
          return;
        }
        await sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  /**
   * Drop the confirmed prefix from the log.
   *
   * Rewriting the remainder rather than truncating: entries appended while the
   * batch was in flight sit after the confirmed ones and must survive.
   */
  private async confirm(count: number): Promise<void> {
    const logPath = this.options.logPath;
    if (!logPath) return;

    this.logWrites = this.logWrites.then(async () => {
      try {
        const raw = await fs.readFile(logPath, 'utf8').catch(() => '');
        const remaining = raw
          .split('\n')
          .filter((line) => line.trim())
          .slice(count);

        if (remaining.length === 0) {
          await fs.rm(logPath, { force: true });
          return;
        }
        await this.writeAtomic(logPath, `${remaining.join('\n')}\n`);
      } catch (error) {
        this.warn(`failed to trim the write log: ${String(error)}`);
      }
    });
    await this.logWrites;
  }

  /**
   * Append one record, serialized against other appends so two enqueues cannot
   * interleave a line.
   *
   * A failure here is surfaced and marks the queue {@link degraded} rather than
   * throwing: an unwritable log means replication is no longer crash-safe, but
   * the run itself is still correct and its trace is still being recorded
   * locally. Killing a working agent run because its replica log is
   * inaccessible trades a recoverable problem for an unrecoverable one.
   */
  private async appendToLog(operation: MessageSyncOperation): Promise<void> {
    const logPath = this.options.logPath;
    if (!logPath) return;

    this.logWrites = this.logWrites.then(async () => {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, `${JSON.stringify(operation)}\n`, 'utf8');
    });

    try {
      await this.logWrites;
    } catch (error) {
      this.logDegraded = true;
      this.warn(`write log is not durable: ${String(error)}`);
      // Reset the chain so one failure does not reject every later append.
      this.logWrites = Promise.resolve();
    }
  }

  private async writeAtomic(filePath: string, content: string): Promise<void> {
    const tmp = `${filePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmp, content, 'utf8');
      await fs.rename(tmp, filePath);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }

  private warn(message: string): void {
    this.options.onError?.(message);
  }
}
