import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryDeviceList: vi.fn(),
  preference: vi.fn(),
  queryPersonal: vi.fn(),
  queryWorkspaceDevices: vi.fn(),
  authorizedDevices: vi.fn(),
}));

vi.mock('@/database/models/devicePool', () => ({
  DevicePoolModel: vi.fn().mockImplementation(function () {
    return { authorizedDevices: mocks.authorizedDevices };
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserPreference: mocks.preference };
  }),
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
    mocks.preference.mockResolvedValue({ lab: { enableDevicePools: true } });
    mocks.queryPersonal.mockResolvedValue([]);
    mocks.queryWorkspaceDevices.mockResolvedValue([]);
    mocks.authorizedDevices.mockResolvedValue([]);
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
    mocks.authorizedDevices.mockResolvedValue([
      { device: row('registered-online') },
      { device: row('registered-offline') },
    ]);
    mocks.queryDeviceList.mockResolvedValue([live('registered-online'), live('gateway-ghost')]);

    const result = await getScopedOnlineDevices(serverDB, 'user-1', 'workspace-1', {
      agentId: 'agent-1',
      blocked: false,
      trigger: 'chat',
      workspaceId: 'workspace-1',
    });

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
    mocks.authorizedDevices.mockRejectedValue(new Error('database unavailable'));
    mocks.queryDeviceList.mockResolvedValue([live('gateway-only')]);

    await expect(
      getScopedOnlineDevices(serverDB, 'user-1', 'workspace-1', {
        agentId: 'agent-1',
        blocked: false,
        trigger: 'chat',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('database unavailable');
  });

  /**
   * @example The previous personal transient fallback cannot bypass registered pool policy.
   */
  it('excludes gateway-only personal devices without an authorization path', async () => {
    mocks.queryDeviceList.mockResolvedValue([live('personal-transient')]);

    const result = await getScopedOnlineDevices(serverDB, 'user-1', undefined, {
      actorUserId: 'user-1',
      agentId: 'agent-1',
      blocked: false,
      trigger: 'chat',
    });

    expect(result).toEqual([]);
  });
});

/** @example Existing personal transient devices remain visible without a Labs preference. */
it('uses legacy discovery without consulting pool grants while disabled', async () => {
  mocks.preference.mockResolvedValue(undefined);
  mocks.queryPersonal.mockResolvedValue([row('registered')]);
  mocks.queryDeviceList.mockResolvedValue([live('transient')]);
  mocks.authorizedDevices.mockClear();
  const devices = await getScopedOnlineDevices(serverDB, 'user-1');
  expect(devices.map((device) => device.deviceId)).toEqual(['transient', 'registered']);
  expect(mocks.authorizedDevices).not.toHaveBeenCalled();
});
/** @example Disabling pools never bypasses existing workspace visibility. */
it('keeps workspace gateway ghosts hidden with Labs disabled', async () => {
  mocks.preference.mockResolvedValue({ lab: { enableDevicePools: false } });
  mocks.queryWorkspaceDevices.mockResolvedValue([]);
  mocks.queryDeviceList.mockResolvedValue([live('ghost')]);
  expect(await getScopedOnlineDevices(serverDB, 'user-1', 'workspace-1')).toEqual([]);
});
