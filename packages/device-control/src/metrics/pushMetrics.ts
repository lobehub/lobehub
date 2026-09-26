import type { DeviceMetricSample } from '@lobechat/types';

interface MetricsTarget {
  readonly connectionStatus: string;
  reportMetrics: (samples: DeviceMetricSample[]) => Promise<void>;
}

/**
 * Push one batch to the device's own connection and mirror it to the
 * workspace-share connections of the same machine. The gateway stores samples
 * under each socket's device identity, so a shared device's workspace row only
 * has health data if the batch also travels over that workspace's socket.
 *
 * The primary push must succeed (a failure keeps the batch for the next
 * attempt); mirrors are best-effort, so a share connection that happens to be
 * down misses that batch rather than holding the device's backlog hostage.
 */
export const pushMetrics = async (
  primary: MetricsTarget,
  mirrors: Iterable<MetricsTarget>,
  samples: DeviceMetricSample[],
): Promise<void> => {
  await primary.reportMetrics(samples);
  await Promise.allSettled(
    [...mirrors]
      .filter((mirror) => mirror !== primary && mirror.connectionStatus === 'connected')
      .map((mirror) => mirror.reportMetrics(samples)),
  );
};
