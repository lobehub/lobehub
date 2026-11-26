// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({
  markSeen: vi.fn(),
  queryDeviceList: vi.fn(),
  queryPersonal: vi.fn(),
  querySharedWorkspaceDevices: vi.fn(),
  queryWorkspaceDevices: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DeviceModel: class {
    markSeen = mocks.markSeen;
    queryPersonal = mocks.queryPersonal;
    querySharedWorkspaceDevices = mocks.querySharedWorkspaceDevices;
    queryWorkspaceDevices = mocks.queryWorkspaceDevices;
  },
}));
vi.mock('@/database/models/user', () => ({
  UserModel: { findByIds: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/server/services/deviceGateway', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deviceGateway: { queryDeviceList: mocks.queryDeviceList },
}));

const registeredAt = new Date('2026-09-26T00:00:00.000Z');

const row = (deviceId: string, workspaceId: string | null = null) => ({
  architecture: null,
  defaultCwd: null,
  deviceId,
  friendlyName: null,
  hostname: null,
  id: `row-${deviceId}`,
  identitySource: 'machine-id',
  lastSeenAt: registeredAt,
  metadata: null,
  platform: 'darwin',
  sharedFromDeviceId: null,
  userId: 'user',
  visibility: 'public',
  workingDirs: [],
  workspaceId,
});

const live = (deviceId: string) => ({
  channels: [
    { channel: 'desktop', connectedAt: registeredAt.toISOString(), connectionId: 'conn-1' },
  ],
  deviceId,
  hostname: deviceId,
  lastSeen: registeredAt.toISOString(),
  online: true,
  platform: 'darwin',
});

describe('device.listDevices last seen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markSeen.mockResolvedValue(undefined);
    mocks.querySharedWorkspaceDevices.mockResolvedValue([]);
    mocks.queryWorkspaceDevices.mockResolvedValue([]);
  });

  /**
   * @example A Mac that held one session since it registered two months ago and dropped a
   * minute ago must not read "offline · connected 2 months ago".
   */
  it('records each pool’s online rows as seen, and only those', async () => {
    // ROOT CAUSE:
    //
    // `devices.lastSeenAt` was written only on register/enroll, and the gateway never
    // reports a disconnect to the server. An offline row's `lastSeen` was therefore its
    // registration time, however long the device had stayed connected since.
    mocks.queryPersonal.mockResolvedValue([row('laptop'), row('old-box')]);
    mocks.queryWorkspaceDevices.mockResolvedValue([row('build-server', 'workspace')]);
    mocks.queryDeviceList.mockImplementation(async (_userId: string, workspaceId?: string) =>
      workspaceId ? [live('build-server')] : [live('laptop')],
    );

    const devices = await deviceRouter
      .createCaller({ userId: 'user', workspaceId: 'workspace', workspaceRole: 'member' } as never)
      .listDevices();

    expect(Object.fromEntries(devices.map((device) => [device.deviceId, device.online]))).toEqual({
      'build-server': true,
      'laptop': true,
      'old-box': false,
    });
    const stamped = mocks.markSeen.mock.calls.flatMap(([ids]) => ids as string[]);
    expect(stamped.sort()).toEqual(['row-build-server', 'row-laptop']);
  });

  it('still lists devices when recording them as seen fails', async () => {
    mocks.queryPersonal.mockResolvedValue([row('laptop')]);
    mocks.queryDeviceList.mockResolvedValue([live('laptop')]);
    mocks.markSeen.mockRejectedValue(new Error('db down'));

    const devices = await deviceRouter.createCaller({ userId: 'user' } as never).listDevices();

    expect(devices).toMatchObject([{ deviceId: 'laptop', online: true }]);
  });
});
