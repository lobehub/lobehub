import type { DeviceMetricSeries } from '@lobechat/types';

import { buildHealthTimeline, type HealthUsage } from './buildHealthTimeline';

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

export type LatestUsageView = { latest: HealthUsage | null; loading: false } | { loading: true };

/**
 * The current CPU / memory / load reading for the card meters and detail stat
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
  };
};
