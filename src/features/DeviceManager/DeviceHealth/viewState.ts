import type { DeviceMetricSeries } from '@lobechat/types';

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
