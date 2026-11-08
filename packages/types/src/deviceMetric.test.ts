import { describe, expect, it } from 'vitest';

import { bucketDeviceMetrics, type DeviceMetricSample } from './deviceMetric';

const MIN = 60_000;
const sample = (
  observedAt: number,
  patch: Partial<DeviceMetricSample> = {},
): DeviceMetricSample => ({
  connected: true,
  cpuCount: 8,
  cpuPercent: 20,
  diskTotalBytes: 1000,
  diskUsedBytes: 400,
  load1: 2,
  load15: 1,
  load5: 1.5,
  memoryTotalBytes: 16_000,
  memoryUsedBytes: 8000,
  observedAt,
  ...patch,
});

describe('bucketDeviceMetrics', () => {
  it('averages each bucket, marks buckets with a disconnected sample, and leaves gaps empty', () => {
    const points = bucketDeviceMetrics(
      [
        sample(9 * MIN, { cpuPercent: 10 }),
        sample(6 * MIN, { connected: false, cpuPercent: 30 }),
        sample(21 * MIN, {
          cpuPercent: 80,
          diskUsedBytes: 900,
          load1: null,
          memoryUsedBytes: 12_000,
        }),
        sample(99 * MIN), // outside the window
      ],
      { bucketMs: 5 * MIN, from: 0, to: 60 * MIN },
    );

    expect(points).toEqual([
      {
        connected: false,
        cpuPercent: 20,
        diskPercent: 40,
        diskUsedBytes: 400,
        load1: 2,
        memoryPercent: 50,
        memoryUsedBytes: 8000,
        observedAt: 5 * MIN,
      },
      {
        connected: true,
        cpuPercent: 80,
        diskPercent: 90,
        diskUsedBytes: 900,
        load1: null,
        memoryPercent: 75,
        memoryUsedBytes: 12_000,
        observedAt: 20 * MIN,
      },
    ]);
  });

  it('leaves the disk empty for samples from devices that do not report it', () => {
    const { diskTotalBytes: _, diskUsedBytes: __, ...legacy } = sample(MIN);
    const unreadable = sample(2 * MIN, { diskTotalBytes: null, diskUsedBytes: null });
    const [point] = bucketDeviceMetrics([legacy, unreadable], {
      bucketMs: 5 * MIN,
      from: 0,
      to: 10 * MIN,
    });

    expect(point).toMatchObject({ diskPercent: null, diskUsedBytes: null, memoryPercent: 50 });
  });
});
