import type { DeviceListItem, DeviceMetricSeries } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildDeviceHoverSummary } from './deviceHoverSummary';

const series: DeviceMetricSeries = {
  bucketMs: 300_000,
  cpuCount: 8,
  diskTotalBytes: 512 * 1024 ** 3,
  from: 0,
  memoryTotalBytes: 32 * 1024 ** 3,
  points: [],
  to: 1,
};

const makeDevice = (overrides: Partial<DeviceListItem> = {}): DeviceListItem => ({
  architecture: 'x64',
  channels: [
    { channel: 'cli', connectedAt: '2026-10-15T10:00:00.000Z', hostname: null, platform: null },
    { channel: 'desktop', connectedAt: '2026-10-15T08:00:00.000Z', hostname: null, platform: null },
  ],
  defaultCwd: '/home/dev/project',
  deviceId: 'dev-1',
  enroller: null,
  friendlyName: 'Dev box',
  hostname: 'dev-box.local',
  identitySource: null,
  lastSeen: '2026-10-14T00:00:00.000Z',
  online: true,
  platform: 'linux',
  registered: true,
  scope: 'personal',
  visibility: null,
  workingDirs: [],
  ...overrides,
});

describe('buildDeviceHoverSummary', () => {
  it('combines the device row with the specs from its metric series', () => {
    expect(buildDeviceHoverSummary(makeDevice(), series)).toEqual({
      architecture: 'x64',
      connections: 2,
      cores: 8,
      diskTotalBytes: 512 * 1024 ** 3,
      enrollerName: undefined,
      hostname: 'dev-box.local',
      lastConnectedAt: '2026-10-15T10:00:00.000Z',
      memoryTotalBytes: 32 * 1024 ** 3,
      online: true,
      onlineUnknown: false,
      platformLabel: 'Linux',
      workingDir: '/home/dev/project',
    });
  });

  it('falls back to the last registration and leaves unreported fields empty', () => {
    const summary = buildDeviceHoverSummary(
      makeDevice({
        architecture: null,
        channels: [],
        defaultCwd: '',
        hostname: null,
        online: false,
        platform: null,
      }),
      { ...series, cpuCount: null, diskTotalBytes: null, memoryTotalBytes: null },
    );

    expect(summary).toMatchObject({
      architecture: undefined,
      connections: 0,
      cores: undefined,
      diskTotalBytes: undefined,
      hostname: undefined,
      lastConnectedAt: '2026-10-14T00:00:00.000Z',
      memoryTotalBytes: undefined,
      online: false,
      platformLabel: undefined,
      workingDir: undefined,
    });
  });

  it('marks a persisted row presence-unknown instead of offline', () => {
    const summary = buildDeviceHoverSummary(
      makeDevice({ channels: [], online: false, onlineUnknown: true }),
    );

    expect(summary).toMatchObject({ online: false, onlineUnknown: true });
  });

  it('leaves specs empty before the metric series loads', () => {
    const summary = buildDeviceHoverSummary(makeDevice());

    expect(summary.cores).toBeUndefined();
    expect(summary.memoryTotalBytes).toBeUndefined();
  });

  it('names the enroller only for workspace devices', () => {
    const enroller = { avatar: null, fullName: null, userId: 'u1', username: 'ada' };

    expect(buildDeviceHoverSummary(makeDevice({ enroller })).enrollerName).toBeUndefined();
    expect(buildDeviceHoverSummary(makeDevice({ enroller, scope: 'workspace' })).enrollerName).toBe(
      'ada',
    );
    expect(
      buildDeviceHoverSummary(
        makeDevice({ enroller: { ...enroller, username: null }, scope: 'workspace' }),
      ).enrollerName,
    ).toBeNull();
  });
});
