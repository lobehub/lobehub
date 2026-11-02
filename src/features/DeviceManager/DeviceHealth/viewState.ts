import type { DeviceMetricSeries } from '@lobechat/types';

import {
  buildHealthTimeline,
  type HealthUsage,
  type LatestUsage,
  loadPercentOf,
  UPLOAD_GRACE_MS,
} from './buildHealthTimeline';

export type HealthViewState = 'empty' | 'error' | 'loading' | 'ready';

/**
 * What the health section should show. A failed read with nothing cached is
 * an error to surface (with a retry), never an endless blank "loading"; once
 * data exists, a later failed refresh keeps showing it.
 */
export const healthViewState = ({
  data,
  error,
}: {
  data?: DeviceMetricSeries;
  error?: unknown;
}): HealthViewState => {
  if (!data) return error ? 'error' : 'loading';
  return data.points.length === 0 ? 'empty' : 'ready';
};

export type LatestUsageView =
  | {
      latest: LatestUsage | null;
      loading: false;
      /**
       * Whether the device reports its disk at all. A device on an `lh` /
       * desktop version that predates disk reporting never will, so its disk
       * row is hidden rather than left as a permanent em dash.
       */
      reportsDisk: boolean;
    }
  | { loading: true };

/**
 * The current CPU / memory / load / disk reading for the card meters and detail stat
 * cards. Loading only while the first read is in flight; a device that never
 * reported, or a failed read, resolves to no reading (em dashes) instead of a
 * skeleton that never ends.
 */
export const latestUsageView = (state: {
  data?: DeviceMetricSeries;
  error?: unknown;
}): LatestUsageView => {
  if (healthViewState(state) === 'loading') return { loading: true };
  const { data } = state;
  return {
    latest: data && data.points.length > 0 ? buildHealthTimeline(data).latest : null,
    loading: false,
    // A series cached before devices reported the disk has no such field.
    reportsDisk: !!data?.diskTotalBytes,
  };
};

/**
 * The newest reading, only while it still describes the machine now: taken
 * within one bucket plus the upload grace of `now`. Judged by the wall clock,
 * not the series' own `to`: a persisted series painted on a reload is as old
 * as its newest sample, and a device that just reconnected after a night
 * offline would otherwise show last night's load as current.
 */
export const currentUsage = (data?: DeviceMetricSeries, now = Date.now()): HealthUsage | null => {
  const newest = data?.points.at(-1);
  if (!data || !newest) return null;
  if (now - newest.observedAt > data.bucketMs + UPLOAD_GRACE_MS) return null;
  return {
    cpuPercent: newest.cpuPercent,
    loadPercent: loadPercentOf(newest.load1, data.cpuCount),
    memoryPercent: newest.memoryPercent,
  };
};
