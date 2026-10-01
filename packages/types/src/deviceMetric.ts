import { z } from 'zod';

// ============================================
// Device metrics — machine health samples (CPU / memory / load average)
// ============================================

/** How often a device takes one sample. One sample averages CPU over this window. */
export const DEVICE_METRIC_SAMPLE_INTERVAL_MS = 60_000;

/** The window the device page charts. */
export const DEVICE_METRIC_VIEW_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * How long samples are kept, both on the device (backlog awaiting upload) and
 * in the device gateway, which is the only place they are stored. Longer than
 * the view window so a machine that was offline overnight can still upload
 * the stretch it spent disconnected.
 */
export const DEVICE_METRIC_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/** Samples per `device_metrics` socket frame (the gateway caps a frame at this many). */
export const DEVICE_METRIC_MAX_BATCH = 500;

/**
 * One machine health sample as reported by a device.
 *
 * `connected` records whether the device held a live gateway connection when
 * the sample was taken. Samples are buffered on the device and uploaded later,
 * so a stretch of `connected: false` samples means "the machine was running
 * but could not reach LobeHub", while a stretch with no samples at all means
 * the machine (or the LobeHub process on it) was not running.
 */
export const deviceMetricSampleSchema = z.object({
  connected: z.boolean(),
  cpuCount: z.number().int().min(1).max(4096),
  /** Share of all cores busy over the sample window, 0–100. */
  cpuPercent: z.number().min(0).max(100).nullable(),
  /** 1 / 5 / 15 minute load averages; null on platforms without them (Windows). */
  load1: z.number().min(0).nullable(),
  load5: z.number().min(0).nullable(),
  load15: z.number().min(0).nullable(),
  memoryTotalBytes: z.number().int().min(0),
  memoryUsedBytes: z.number().int().min(0),
  /** Epoch milliseconds, taken on the device. */
  observedAt: z.number().int().min(0),
});

export type DeviceMetricSample = z.infer<typeof deviceMetricSampleSchema>;

/** One charted point — a sample, or the average of the samples in one bucket. */
export interface DeviceMetricPoint {
  /** False when any sample in the bucket was taken while disconnected. */
  connected: boolean;
  cpuPercent: number | null;
  load1: number | null;
  memoryPercent: number | null;
  memoryUsedBytes: number | null;
  /** Epoch milliseconds — bucket start when bucketed. */
  observedAt: number;
}

export interface DeviceMetricSeries {
  /** Bucket width the points were aggregated into. */
  bucketMs: number;
  /** From the newest sample; null when the device never reported. */
  cpuCount: number | null;
  from: number;
  memoryTotalBytes: number | null;
  points: DeviceMetricPoint[];
  to: number;
}

const average = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length;
};

/**
 * Average raw samples into `bucketMs`-wide buckets over `[from, to]`,
 * ascending. Buckets with no samples are absent — the gap IS the signal (the
 * machine, or LobeHub on it, was not running).
 */
export const bucketDeviceMetrics = (
  samples: DeviceMetricSample[],
  { bucketMs, from, to }: { bucketMs: number; from: number; to: number },
): DeviceMetricPoint[] => {
  const buckets = new Map<number, DeviceMetricSample[]>();
  for (const sample of samples) {
    if (sample.observedAt < from || sample.observedAt > to) continue;
    const start = Math.floor(sample.observedAt / bucketMs) * bucketMs;
    const bucket = buckets.get(start) ?? [];
    bucket.push(sample);
    buckets.set(start, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([observedAt, group]) => ({
      connected: group.every((s) => s.connected),
      cpuPercent: average(group.map((s) => s.cpuPercent)),
      load1: average(group.map((s) => s.load1)),
      memoryPercent: average(
        group.map((s) =>
          s.memoryTotalBytes > 0 ? (s.memoryUsedBytes * 100) / s.memoryTotalBytes : null,
        ),
      ),
      memoryUsedBytes: average(group.map((s) => s.memoryUsedBytes)),
      observedAt,
    }));
};
