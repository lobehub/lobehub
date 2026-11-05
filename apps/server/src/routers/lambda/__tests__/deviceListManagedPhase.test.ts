// @vitest-environment node
import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';
import { MANAGED_PHASES_TIMEOUT_MS } from '../device/registry';

const mocks = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  listStates: vi.fn(),
  queryDeviceList: vi.fn(),
  queryPersonal: vi.fn(),
  querySharedWorkspaceDevices: vi.fn(),
  queryWorkspaceDevices: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/device', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DeviceModel: class {
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
vi.mock('@/business/server/managedDevice', () => ({
  managedDeviceProvider: {
    isAvailable: mocks.isAvailable,
    listStates: mocks.listStates,
    wake: vi.fn(),
  },
}));

const row = (deviceId: string, identitySource: string, workspaceId: string | null = null) => ({
  architecture: null,
  defaultCwd: null,
  deviceId,
  friendlyName: null,
  hostname: null,
  identitySource,
  lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
  metadata: null,
  platform: 'linux',
  sharedFromDeviceId: null,
  userId: 'user',
  visibility: 'public',
  workingDirs: [],
  workspaceId,
});

const personalCaller = () => deviceRouter.createCaller({ userId: 'user' } as never);
const workspaceCaller = () =>
  deviceRouter.createCaller({
    userId: 'user',
    workspaceId: 'workspace',
    workspaceRole: 'member',
  } as never);

const phaseOf = (devices: { deviceId: string; managedPhase?: string }[], deviceId: string) =>
  devices.find((device) => device.deviceId === deviceId)?.managedPhase;

describe('device.listDevices managed device phases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAvailable.mockReturnValue(true);
    mocks.queryDeviceList.mockResolvedValue([]);
    mocks.querySharedWorkspaceDevices.mockResolvedValue([]);
    mocks.queryWorkspaceDevices.mockResolvedValue([]);
  });

  it('attaches the provider phase to managed rows only', async () => {
    mocks.queryPersonal.mockResolvedValue([
      row('managed', MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE),
      row('laptop', 'machine-id'),
    ]);
    mocks.listStates.mockResolvedValue({ laptop: 'suspended', managed: 'suspended' });

    const devices = await personalCaller().listDevices();

    expect(phaseOf(devices, 'managed')).toBe('suspended');
    expect(phaseOf(devices, 'laptop')).toBeUndefined();
    expect(mocks.listStates).toHaveBeenCalledTimes(1);
    expect(mocks.listStates).toHaveBeenCalledWith({ userId: 'user' });
  });

  it('asks the provider nothing when no row is managed', async () => {
    mocks.queryPersonal.mockResolvedValue([row('laptop', 'machine-id')]);

    await personalCaller().listDevices();

    expect(mocks.isAvailable).not.toHaveBeenCalled();
    expect(mocks.listStates).not.toHaveBeenCalled();
  });

  it('asks each pool that holds a managed row under its own scope', async () => {
    mocks.queryPersonal.mockResolvedValue([
      row('personal-managed', MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE),
    ]);
    mocks.queryWorkspaceDevices.mockResolvedValue([
      row('ws-managed', MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE, 'workspace'),
    ]);
    mocks.listStates.mockImplementation(async (scope: { workspaceId?: string }) =>
      scope.workspaceId ? { 'ws-managed': 'waking' } : { 'personal-managed': 'failed' },
    );

    const devices = await workspaceCaller().listDevices();

    expect(phaseOf(devices, 'personal-managed')).toBe('failed');
    expect(phaseOf(devices, 'ws-managed')).toBe('waking');
    expect(mocks.listStates).toHaveBeenCalledTimes(2);
    expect(mocks.listStates).toHaveBeenCalledWith({ userId: 'user' });
    expect(mocks.listStates).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace' });
  });

  it('still lists managed devices when the provider is unavailable', async () => {
    mocks.isAvailable.mockReturnValue(false);
    mocks.queryPersonal.mockResolvedValue([row('managed', MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE)]);

    const devices = await personalCaller().listDevices();

    expect(devices.map((device) => device.deviceId)).toEqual(['managed']);
    expect(phaseOf(devices, 'managed')).toBeUndefined();
    expect(mocks.listStates).not.toHaveBeenCalled();
  });

  it('still lists managed devices when the provider fails', async () => {
    mocks.queryPersonal.mockResolvedValue([row('managed', MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE)]);
    mocks.listStates.mockRejectedValue(new Error('provider down'));

    const devices = await personalCaller().listDevices();

    expect(devices.map((device) => device.deviceId)).toEqual(['managed']);
    expect(phaseOf(devices, 'managed')).toBeUndefined();
  });

  it('still lists managed devices when the provider does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      mocks.queryPersonal.mockResolvedValue([row('managed', MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE)]);
      mocks.listStates.mockReturnValue(new Promise(() => {}));

      const pending = personalCaller().listDevices();
      await vi.advanceTimersByTimeAsync(MANAGED_PHASES_TIMEOUT_MS);
      const devices = await pending;

      expect(devices.map((device) => device.deviceId)).toEqual(['managed']);
      expect(phaseOf(devices, 'managed')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
