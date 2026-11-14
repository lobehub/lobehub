import { appendFileSync } from 'node:fs';
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { LogProcess } from './layout';
import { MAX_LOG_BYTES, MAX_LOG_GENERATIONS } from './layout';
import { createLogRecord, serializeLogRecord } from './record';

/**
 * Past this many queued bytes new lines are dropped (and counted) instead of
 * growing the heap while the disk does not respond.
 */
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
/** Batches lines so a chatty `debug` stream costs one append per window, not one per line. */
const FLUSH_DELAY_MS = 200;

export interface JsonlLogWriterOptions {
  filePath: string;
  flushDelayMs?: number;
  maxBytes?: number;
  maxGenerations?: number;
  maxPendingBytes?: number;
  /** Stamped on the writer's own dropped-lines warning so `desktop:logs` process filters keep it. */
  process: LogProcess;
}

/**
 * Buffered, size-rotated JSONL appender. `write()` only enqueues; one drain at a
 * time appends the batch with `fs/promises`, so a stalled disk backs lines up in
 * memory instead of blocking the main process event loop. `flushSync()` exists
 * only for the `process.on('exit')` hook, which cannot await.
 */
export class JsonlLogWriter {
  readonly filePath: string;
  private readonly flushDelayMs: number;
  private readonly maxBytes: number;
  private readonly maxGenerations: number;
  private readonly maxPendingBytes: number;
  private readonly process: LogProcess;

  private bytesWritten: number | undefined;
  private draining: Promise<void> | undefined;
  /** The batch `drain()` has taken but not yet confirmed on disk. */
  private inFlight: string | undefined;
  private droppedLines = 0;
  private pending: string[] = [];
  private pendingBytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor({
    filePath,
    flushDelayMs = FLUSH_DELAY_MS,
    maxBytes = MAX_LOG_BYTES,
    maxGenerations = MAX_LOG_GENERATIONS,
    maxPendingBytes = MAX_PENDING_BYTES,
    process,
  }: JsonlLogWriterOptions) {
    this.filePath = filePath;
    this.flushDelayMs = flushDelayMs;
    this.maxBytes = maxBytes;
    this.maxGenerations = maxGenerations;
    this.maxPendingBytes = maxPendingBytes;
    this.process = process;
  }

  /** Queues one complete line (ending in `\n`). `urgent` flushes on the next tick, for errors. */
  write(line: string, { urgent = false }: { urgent?: boolean } = {}) {
    if (this.pendingBytes >= this.maxPendingBytes) {
      this.droppedLines += 1;
      return;
    }
    this.pending.push(line);
    this.pendingBytes += Buffer.byteLength(line);
    this.schedule(urgent ? 0 : this.flushDelayMs);
  }

  /** Resolves once every line queued before the call is on disk. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.draining || this.hasWork()) {
      this.draining ??= this.drain().finally(() => {
        this.draining = undefined;
      });
      await this.draining;
    }
  }

  /**
   * Synchronous last-chance write for `process.on('exit')`; skips rotation. It also
   * rewrites a batch whose async append has not resolved, because the process exits
   * before that append is known to land: a possible duplicate line beats a lost
   * final batch, which is usually the one that explains the exit.
   */
  flushSync() {
    const batch = [this.inFlight, this.takeBatch()].filter(Boolean).join('');
    this.inFlight = undefined;
    if (!batch) return;
    try {
      appendFileSync(this.filePath, batch);
    } catch {
      // Nowhere left to report a failed log write at exit.
    }
  }

  private hasWork() {
    return this.pending.length > 0 || this.droppedLines > 0;
  }

  private schedule(delayMs: number) {
    if (this.draining) return;
    if (this.timer) {
      if (delayMs > 0) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delayMs);
    this.timer.unref?.();
  }

  private takeBatch(): string | undefined {
    if (!this.hasWork()) return undefined;
    const lines = this.pending;
    if (this.droppedLines > 0) {
      lines.push(
        serializeLogRecord(
          createLogRecord({
            level: 'warn',
            message: `dropped ${this.droppedLines} log lines while the disk was not keeping up`,
            ns: 'structuredLog',
            process: this.process,
          }),
        ),
      );
    }
    this.pending = [];
    this.pendingBytes = 0;
    this.droppedLines = 0;
    return lines.join('');
  }

  private async drain() {
    const batch = this.takeBatch();
    if (!batch) return;
    this.inFlight = batch;
    try {
      const size = Buffer.byteLength(batch);
      if (this.bytesWritten === undefined) {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        this.bytesWritten = await stat(this.filePath).then(
          (stats) => stats.size,
          () => 0,
        );
      }
      if (this.bytesWritten > 0 && this.bytesWritten + size > this.maxBytes) await this.rotate();
      await appendFile(this.filePath, batch);
      this.bytesWritten += size;
      this.inFlight = undefined;
    } catch (error) {
      // A log write must never take the app down; the next batch retries the file.
      this.bytesWritten = undefined;
      this.inFlight = undefined;
      process.stderr.write(`[structuredLog] failed to write ${this.filePath}: ${String(error)}\n`);
    }
  }

  private async rotate() {
    await rm(`${this.filePath}.${this.maxGenerations}`, { force: true });
    for (let generation = this.maxGenerations - 1; generation >= 1; generation -= 1) {
      await rename(`${this.filePath}.${generation}`, `${this.filePath}.${generation + 1}`).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        },
      );
    }
    await rename(this.filePath, `${this.filePath}.1`);
    this.bytesWritten = 0;
  }
}
