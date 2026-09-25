import type { DeviceMetricPoint, DeviceMetricSeries } from '@lobechat/types';

/**
 * What the device was doing during one bucket:
 * - `online` — running and connected to LobeHub.
 * - `offline` — running (it took samples) but not connected: a network or
 *   gateway problem rather than a machine problem.
 * - `missing` — no samples: the machine was asleep / off, or LobeHub was not
 *   running on it.
 * - `pending` — the most recent buckets, whose samples may simply not have
 *   been uploaded yet.
 */
export type HealthSlotStatus = 'online' | 'offline' | 'missing' | 'pending';

export interface HealthSlot {
  cpuPercent: number | null;
  load1: number | null;
  memoryPercent: number | null;
  memoryUsedBytes: number | null;
  start: number;
  status: HealthSlotStatus;
}

export interface HealthStretch {
  end: number;
  start: number;
  status: 'offline' | 'missing';
}

export interface HealthTimeline {
  /** Newest reading of each metric, for the section headers. */
  latest: Pick<DeviceMetricPoint, 'cpuPercent' | 'load1' | 'memoryPercent'> | null;
  /** Upper bound for the load chart — at least the core count, so a busy-but-fine machine sits below it. */
  loadCeiling: number;
  slots: HealthSlot[];
  /** Contiguous offline / missing periods, oldest first. */
  stretches: HealthStretch[];
}

/**
 * Devices upload every few minutes, so the tail of the window is expected to
 * be empty for a while; only call it missing once it is older than this.
 */
export const UPLOAD_GRACE_MS = 10 * 60_000;

export const buildHealthTimeline = (series: DeviceMetricSeries): HealthTimeline => {
  const { bucketMs, from, points, to } = series;
  const byStart = new Map(points.map((p) => [p.observedAt, p]));
  const firstStart = Math.floor(from / bucketMs) * bucketMs;

  const slots: HealthSlot[] = [];
  for (let start = firstStart; start <= to; start += bucketMs) {
    const point = byStart.get(start);
    const status: HealthSlotStatus = point
      ? point.connected
        ? 'online'
        : 'offline'
      : start + bucketMs > to - UPLOAD_GRACE_MS
        ? 'pending'
        : 'missing';
    slots.push({
      cpuPercent: point?.cpuPercent ?? null,
      load1: point?.load1 ?? null,
      memoryPercent: point?.memoryPercent ?? null,
      memoryUsedBytes: point?.memoryUsedBytes ?? null,
      start,
      status,
    });
  }

  const stretches: HealthStretch[] = [];
  for (const slot of slots) {
    if (slot.status !== 'offline' && slot.status !== 'missing') continue;
    const last = stretches.at(-1);
    if (last && last.status === slot.status && last.end === slot.start) {
      last.end = slot.start + bucketMs;
    } else {
      stretches.push({ end: slot.start + bucketMs, start: slot.start, status: slot.status });
    }
  }

  const newest = points.at(-1);
  const maxLoad = Math.max(0, ...points.map((p) => p.load1 ?? 0));

  return {
    latest: newest
      ? {
          cpuPercent: newest.cpuPercent,
          load1: newest.load1,
          memoryPercent: newest.memoryPercent,
        }
      : null,
    loadCeiling: Math.max(series.cpuCount ?? 1, Math.ceil(maxLoad)),
    slots,
    stretches,
  };
};

export interface HealthStripBlock {
  end: number;
  start: number;
  status: HealthSlotStatus;
}

/** Most to least telling when slots of different kinds share one block. */
const STRIP_PRIORITY: HealthSlotStatus[] = ['offline', 'online', 'pending', 'missing'];

/**
 * Merge consecutive slots into blocks wide enough to see and hover — a 12h
 * window of 5-minute slots is 144 hair-thin blocks in a side panel. A block
 * takes its most telling slot status: a disconnect anywhere in it shows, and
 * a block where the device ran for part of the time reads as running.
 */
export const groupStripBlocks = (
  slots: HealthSlot[],
  bucketMs: number,
  slotsPerBlock: number,
): HealthStripBlock[] => {
  const blocks: HealthStripBlock[] = [];
  for (let i = 0; i < slots.length; i += slotsPerBlock) {
    const group = slots.slice(i, i + slotsPerBlock);
    const status =
      STRIP_PRIORITY.find((candidate) => group.some((slot) => slot.status === candidate)) ??
      'missing';
    blocks.push({ end: group.at(-1)!.start + bucketMs, start: group[0].start, status });
  }
  return blocks;
};
