import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryDeviceList: vi.fn(),
  queryPersonal: vi.fn(),
  queryWorkspaceDevices: vi.fn(),
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(function () {
    return {
      queryPersonal: mocks.queryPersonal,
      queryWorkspaceDevices: mocks.queryWorkspaceDevices,
    };
  }),
}));

vi.mock('./index', () => ({
  deviceGateway: { queryDeviceList: mocks.queryDeviceList },
}));

const { getScopedOnlineDevices } = await import('./scopedDevices');

const serverDB = {} as unknown as LobeChatDatabase;
const row = (deviceId: string) => ({
  deviceId,
  friendlyName: null,
  hostname: `${deviceId}-db`,
  lastSeenAt: new Date('2026-09-09T00:00:00.000Z'),
  platform: 'darwin',
});
const live = (deviceId: string) => ({
  channels: [
    { channel: 'desktop', connectedAt: '2026-09-09T01:00:00.000Z', connectionId: 'conn-1' },
  ],
  deviceId,
  hostname: `${deviceId}-live`,
  lastSeen: '2026-09-09T01:00:00.000Z',
  online: true,
  platform: 'darwin',
});

describe('getScopedOnlineDevices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryPersonal.mockResolvedValue([]);
    mocks.queryWorkspaceDevices.mockResolvedValue([]);
    mocks.queryDeviceList.mockResolvedValue([]);
  });

  /**
   * @example A stale workspace socket cannot recreate a device after Unshare removed its row.
   */
  it('keeps registered workspace rows and excludes gateway-only workspace devices', async () => {
    // ROOT CAUSE:
    //
    // Workspace presence used to be authoritative even without a registry row.
    // A process that missed Unshare therefore resurfaced as an executable ghost.
    //
    // Before: registered rows plus every Gateway-only workspace device.
    // After: workspace rows are authoritative; Gateway only supplies liveness.
    mocks.queryWorkspaceDevices.mockResolvedValue([
      row('registered-online'),
      row('registered-offline'),
    ]);
    mocks.queryDeviceList.mockResolvedValue([live('registered-online'), live('gateway-ghost')]);

    const result = await getScopedOnlineDevices(serverDB, 'user-1', 'workspace-1');

    expect(result.map((device) => device.deviceId)).toEqual([
      'registered-online',
      'registered-offline',
    ]);
    expect(result[0]).toMatchObject({ online: true, scope: 'workspace' });
    expect(result[1]).toMatchObject({ online: false, scope: 'workspace' });
  });

  /**
   * @example A workspace registry outage cannot turn an unverified socket into an authorized device.
   */
  it('fails closed when workspace registry lookup fails', async () => {
    mocks.queryWorkspaceDevices.mockRejectedValue(new Error('database unavailable'));
    mocks.queryDeviceList.mockResolvedValue([live('gateway-only')]);

    const result = await getScopedOnlineDevices(serverDB, 'user-1', 'workspace-1');

    expect(result).toEqual([]);
  });

  /**
   * @example Personal auto-registration remains backward compatible during its short race window.
   */
  it('retains gateway-only personal devices as transient entries', async () => {
    mocks.queryDeviceList.mockResolvedValue([live('personal-transient')]);

    const result = await getScopedOnlineDevices(serverDB, 'user-1');

    expect(result).toEqual([
      expect.objectContaining({
        deviceId: 'personal-transient',
        online: true,
        scope: 'personal',
      }),
    ]);
  });
});
