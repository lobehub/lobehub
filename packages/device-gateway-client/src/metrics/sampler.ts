import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DeviceMetricSample } from '@lobechat/types';
import {
  DEVICE_METRIC_MAX_BATCH,
  DEVICE_METRIC_RETENTION_MS,
  DEVICE_METRIC_SAMPLE_INTERVAL_MS,
  deviceMetricSampleSchema,
} from '@lobechat/types';

import type { CpuTimes, MemoryUsage } from './systemSnapshot';
import {
  cpuPercentBetween,
  readCpuTimes,
  readLoadAverage,
  readMemoryUsage,
} from './systemSnapshot';

/** Upload cadence. Samples are still taken every minute and survive until uploaded. */
const DEFAULT_FLUSH_INTERVAL_MS = 5 * 60_000;

interface SamplerLogger {
  debug?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface DeviceMetricsSamplerOptions {
  flushIntervalMs?: number;
  /** Whether the device currently holds a live gateway connection. */
  isConnected: () => boolean;
  logger?: SamplerLogger;
  now?: () => number;
  /** Test seams for the machine readings. */
  readers?: {
    cpuTimes?: () => CpuTimes;
    loadAverage?: () => [number, number, number] | null;
    memory?: () => Promise<MemoryUsage>;
  };
  sampleIntervalMs?: number;
  /**
   * File holding samples not yet uploaded, so a backlog collected while the
   * device could not reach LobeHub survives a restart. Omit to keep it in
   * memory only.
   */
  storagePath?: string;
  /** Deliver a batch to LobeHub; throw to keep the batch for the next attempt. */
  upload: (samples: DeviceMetricSample[]) => Promise<void>;
}

/**
 * Samples this machine's CPU / memory / load once a minute and uploads the
 * samples in batches. Samples are kept locally until an upload succeeds, so
 * the stretch a device spent disconnected is uploaded once it reconnects —
 * that stretch is exactly what explains a drop.
 */
export class DeviceMetricsSampler {
  private readonly options: DeviceMetricsSamplerOptions;
  private readonly now: () => number;
  private pending: DeviceMetricSample[] = [];
  private lastCpu?: CpuTimes;
  private sampleTimer?: ReturnType<typeof setInterval>;
  private flushTimer?: ReturnType<typeof setInterval>;
  private flushing?: Promise<void>;
  private started = false;

  constructor(options: DeviceMetricsSamplerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.pending = [...(await this.loadBacklog()), ...this.pending];
    this.lastCpu = (this.options.readers?.cpuTimes ?? readCpuTimes)();

    const sampleEvery = this.options.sampleIntervalMs ?? DEVICE_METRIC_SAMPLE_INTERVAL_MS;
    const flushEvery = this.options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.sampleTimer = setInterval(() => void this.sample(), sampleEvery);
    this.flushTimer = setInterval(() => void this.flush(), flushEvery);
    // A background sampler must never keep a CLI process alive on its own.
    this.sampleTimer.unref?.();
    this.flushTimer.unref?.();
  }

  /**
   * Stop sampling. With `flushTimeoutMs`, first try to upload what is pending
   * (bounded, so shutdown never hangs on a dead connection): on a clean exit
   * the minutes since the last upload would otherwise read as "not running"
   * until the next start.
   */
  async stop(options: { flushTimeoutMs?: number } = {}): Promise<void> {
    if (!this.started) return;
    this.started = false;
    clearInterval(this.sampleTimer);
    clearInterval(this.flushTimer);
    if (options.flushTimeoutMs) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.flush(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, options.flushTimeoutMs);
        }),
      ]);
      clearTimeout(timer);
    } else {
      await this.flushing;
    }
    await this.persist();
  }

  /** Take one sample now. Exposed for the interval and for tests. */
  async sample(): Promise<void> {
    const readers = this.options.readers ?? {};
    const cpu = (readers.cpuTimes ?? readCpuTimes)();
    const cpuPercent = this.lastCpu ? cpuPercentBetween(this.lastCpu, cpu) : null;
    this.lastCpu = cpu;

    try {
      const memory = await (readers.memory ?? readMemoryUsage)();
      const load = (readers.loadAverage ?? readLoadAverage)();
      this.pending.push({
        connected: this.options.isConnected(),
        cpuCount: Math.max(1, os.cpus().length),
        cpuPercent,
        load1: load?.[0] ?? null,
        load15: load?.[2] ?? null,
        load5: load?.[1] ?? null,
        memoryTotalBytes: memory.totalBytes,
        memoryUsedBytes: memory.usedBytes,
        observedAt: this.now(),
      });
      this.trim();
      await this.persist();
    } catch (error) {
      this.options.logger?.warn?.(`device metrics sample failed: ${(error as Error).message}`);
    }
  }

  /**
   * Upload everything pending, oldest first. Called on the timer and by the
   * host right after the device (re)connects, so a backlog lands promptly.
   */
  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  /** Samples waiting for upload (tests / diagnostics). */
  get pendingCount(): number {
    return this.pending.length;
  }

  private async doFlush(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.slice(0, DEVICE_METRIC_MAX_BATCH);
      try {
        await this.options.upload(batch);
      } catch (error) {
        this.options.logger?.debug?.(
          `device metrics upload deferred (${this.pending.length} pending): ${(error as Error).message}`,
        );
        return;
      }
      // Samples taken while the upload was in flight stay queued.
      const uploaded = new Set(batch);
      this.pending = this.pending.filter((s) => !uploaded.has(s));
      await this.persist();
    }
  }

  private trim() {
    const oldest = this.now() - DEVICE_METRIC_RETENTION_MS;
    this.pending = this.pending.filter((s) => s.observedAt >= oldest);
  }

  private async loadBacklog(): Promise<DeviceMetricSample[]> {
    const file = this.options.storagePath;
    if (!file) return [];
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      const oldest = this.now() - DEVICE_METRIC_RETENTION_MS;
      return parsed.flatMap((raw) => {
        const result = deviceMetricSampleSchema.safeParse(raw);
        return result.success && result.data.observedAt >= oldest ? [result.data] : [];
      });
    } catch {
      return [];
    }
  }

  private async persist(): Promise<void> {
    const file = this.options.storagePath;
    if (!file) return;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      // Write-then-rename: a crash mid-write must not corrupt the backlog.
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(this.pending));
      await rename(tmp, file);
    } catch (error) {
      this.options.logger?.warn?.(
        `device metrics backlog write failed: ${(error as Error).message}`,
      );
    }
  }
}
