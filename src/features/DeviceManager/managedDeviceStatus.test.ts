/**
 * @vitest-environment happy-dom
 */
import type { DeviceListItem, ManagedDevicePhase } from '@lobechat/types';
import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { cssVar } from '@lobehub/ui';
import { renderHook } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { describe, expect, it } from 'vitest';

import {
  getManagedDeviceStatus,
  managedStatusColor,
  presenceDotColor,
} from './managedDeviceStatus';
import { useDeviceActivityText } from './useDeviceActivityText';

dayjs.extend(relativeTime);

const channel = {
  channel: 'cli' as const,
  connectedAt: '2026-01-01T00:00:00.000Z',
  hostname: 'managed-host',
  platform: 'linux',
};

const buildDevice = (overrides: Partial<DeviceListItem> = {}): DeviceListItem => ({
  channels: [],
  defaultCwd: null,
  deviceId: 'managed-device',
  enroller: null,
  friendlyName: null,
  hostname: null,
  identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
  lastSeen: '2026-01-01T00:00:00.000Z',
  online: false,
  platform: 'linux',
  registered: true,
  scope: 'personal',
  visibility: null,
  workingDirs: [],
  ...overrides,
});

const managed = (managedPhase: ManagedDevicePhase, overrides: Partial<DeviceListItem> = {}) =>
  buildDevice({ managedPhase, ...overrides });

describe('getManagedDeviceStatus', () => {
  it.each([
    ['suspended', 'sleeping'],
    ['suspending', 'stopping'],
    ['pending', 'starting'],
    ['waking', 'starting'],
    ['running', 'starting'],
    ['failed', 'failed'],
    ['deleting', 'deleting'],
  ] as const)('maps an offline %s device to %s', (phase, status) => {
    expect(getManagedDeviceStatus(managed(phase))).toBe(status);
  });

  it.each(['suspended', 'pending', 'waking', 'running'] as const)(
    'lets a live connection describe a %s device',
    (phase) => {
      expect(getManagedDeviceStatus(managed(phase, { channels: [channel], online: true }))).toBe(
        null,
      );
    },
  );

  it('keeps failed and deleting even while connected', () => {
    const connected = { channels: [channel], online: true };
    expect(getManagedDeviceStatus(managed('failed', connected))).toBe('failed');
    expect(getManagedDeviceStatus(managed('deleting', connected))).toBe('deleting');
  });

  it('keeps the checking state for a restored row', () => {
    expect(getManagedDeviceStatus(managed('suspended', { onlineUnknown: true }))).toBe(null);
  });

  it('ignores a phase on a device the user connected', () => {
    expect(
      getManagedDeviceStatus(managed('suspended', { identitySource: 'machine-id' })),
    ).toBeNull();
  });

  it('falls back to presence when the phase is unknown', () => {
    expect(getManagedDeviceStatus(buildDevice())).toBeNull();
  });
});

describe('presenceDotColor', () => {
  it('uses the managed status color, else the online and offline colors', () => {
    expect(presenceDotColor('sleeping', true)).toBe(managedStatusColor.sleeping);
    expect(presenceDotColor(null, true)).toBe(cssVar.colorSuccess);
    expect(presenceDotColor(null, false)).toBe(cssVar.colorTextQuaternary);
  });
});

describe('useDeviceActivityText for a managed device', () => {
  const text = (device: DeviceListItem) =>
    renderHook(() => useDeviceActivityText(device)).result.current;

  it('says a sleeping device wakes on demand instead of when it last connected', () => {
    expect(text(managed('suspended'))).toBe('devices.managed.status.sleepingHint');
  });

  it('says a waking device is starting', () => {
    expect(text(managed('waking'))).toBe('devices.managed.status.starting');
    expect(text(managed('pending'))).toBe('devices.managed.status.starting');
  });

  it('shows a failed device as unavailable', () => {
    expect(text(managed('failed'))).toBe('devices.managed.status.failed');
  });

  it('shows an online managed device like any other online device', () => {
    expect(text(managed('running', { channels: [channel], online: true }))).toContain(
      'devices.status.online',
    );
  });

  it('shows the last connection when the phase is unknown', () => {
    expect(text(buildDevice())).toBe('devices.lastSeen');
  });
});
