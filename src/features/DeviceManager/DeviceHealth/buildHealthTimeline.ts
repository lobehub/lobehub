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

/** CPU / memory / load, each as a percentage (load relative to the core count). */
export interface HealthUsage {
  cpuPercent: number | null;
  loadPercent: number | null;
  memoryPercent: number | null;
}

export interface HealthSlot extends HealthUsage {
  memoryUsedBytes: number | null;
  start: number;
  status: HealthSlotStatus;
}

export interface HealthTimeline {
  /** Newest reading of each metric, for the chart headers and the row preview. */
  latest: HealthUsage | null;
  /** Upper bound for the load chart — at least 100%, so an overloaded machine still fits. */
  loadCeiling: number;
  slots: HealthSlot[];
}

/**
 * Devices upload every few minutes, so the tail of the window is expected to
 * be empty for a while; only call it missing once it is older than this.
 */
export const UPLOAD_GRACE_MS = 10 * 60_000;

/** Load average as a share of the machine's cores; null without both. */
export const loadPercentOf = (load1: number | null | undefined, cpuCount: number | null) =>
  load1 === null || load1 === undefined || !cpuCount ? null : (load1 / cpuCount) * 100;

export const buildHealthTimeline = (series: DeviceMetricSeries): HealthTimeline => {
  const { bucketMs, cpuCount, from, points, to } = series;
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
      loadPercent: loadPercentOf(point?.load1, cpuCount),
      memoryPercent: point?.memoryPercent ?? null,
      memoryUsedBytes: point?.memoryUsedBytes ?? null,
      start,
      status,
    });
  }

  const newest: DeviceMetricPoint | undefined = points.at(-1);
  const maxLoad = Math.max(0, ...slots.map((s) => s.loadPercent ?? 0));

  return {
    latest: newest
      ? {
          cpuPercent: newest.cpuPercent,
          loadPercent: loadPercentOf(newest.load1, cpuCount),
          memoryPercent: newest.memoryPercent,
        }
      : null,
    loadCeiling: Math.max(100, Math.ceil(maxLoad)),
    slots,
  };
};

export interface HealthStripBlock {
  end: number;
  /** Highest CPU / memory / load inside the block — what its color reflects. */
  peak: HealthUsage;
  start: number;
  status: HealthSlotStatus;
}

/** Most to least telling when slots of different kinds share one block. */
const STRIP_PRIORITY: HealthSlotStatus[] = ['offline', 'online', 'pending', 'missing'];

const maxOf = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.max(...present);
};

/**
 * Merge consecutive slots into blocks wide enough to see and hover — a 12h
 * window of 5-minute slots is 144 hair-thin blocks in a side panel. Blocks
 * sit on wall-clock boundaries (e.g. :00 / :30) so their hover times read
 * naturally. A block takes its most telling slot status: a disconnect
 * anywhere in it shows, and a block where the device ran for part of the time
 * reads as running.
 */
export const groupStripBlocks = (
  slots: HealthSlot[],
  bucketMs: number,
  blockMs: number,
): HealthStripBlock[] => {
  const groups = new Map<number, HealthSlot[]>();
  for (const slot of slots) {
    const key = Math.floor(slot.start / blockMs) * blockMs;
    const group = groups.get(key) ?? [];
    group.push(slot);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const status =
      STRIP_PRIORITY.find((candidate) => group.some((slot) => slot.status === candidate)) ??
      'missing';
    return {
      end: group.at(-1)!.start + bucketMs,
      peak: {
        cpuPercent: maxOf(group.map((s) => s.cpuPercent)),
        loadPercent: maxOf(group.map((s) => s.loadPercent)),
        memoryPercent: maxOf(group.map((s) => s.memoryPercent)),
      },
      start: group[0].start,
      status,
    };
  });
};
