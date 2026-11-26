import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  startManagedDeviceForActivation: vi.fn(),
  getScopedOnlineDevices: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { queryDeviceList: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: mocks.getScopedOnlineDevices,
}));

vi.mock('@/server/services/deviceGateway/managedDeviceWake', () => ({
  startManagedDeviceForActivation: mocks.startManagedDeviceForActivation,
}));

const { remoteDeviceRuntime } = await import('../remoteDevice');

const context: ToolExecutionContext = {
  activeDeviceScope: 'personal',
  serverDB: {} as any,
  toolManifestMap: {},
  userId: 'user-1',
};
const managedOnline = {
  deviceId: 'managed-a',
  hostname: 'managed-a',
  lastSeen: '2026-01-01T00:00:00.000Z',
  online: true,
  platform: 'linux',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getScopedOnlineDevices.mockResolvedValue([]);
});

const managedAsleep = { ...managedOnline, managed: true, online: false };

describe('remoteDeviceRuntime — managed cloud devices', () => {
  it('lists a sleeping managed device as online', async () => {
    mocks.getScopedOnlineDevices.mockResolvedValue([managedAsleep]);

    const runtime = remoteDeviceRuntime.factory(context) as any;
    const result = await runtime.listOnlineDevices();

    expect(result.state.devices).toEqual([{ ...managedAsleep, online: true }]);
  });

  it('activates a sleeping managed device at once and starts it', async () => {
    mocks.getScopedOnlineDevices.mockResolvedValue([managedAsleep]);
    mocks.startManagedDeviceForActivation.mockResolvedValue('starting');

    const runtime = remoteDeviceRuntime.factory(context) as any;
    const result = await runtime.activateDevice({ deviceId: 'managed-a' });

    expect(mocks.startManagedDeviceForActivation).toHaveBeenCalledWith(
      { db: context.serverDB, userId: 'user-1', workspaceId: undefined },
      'managed-a',
    );
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      activatedDevice: { deviceId: 'managed-a', online: true },
      metadata: { activeDeviceId: 'managed-a' },
    });
  });

  it('activates the managed device when it is online already', async () => {
    mocks.getScopedOnlineDevices.mockResolvedValueOnce([]).mockResolvedValue([managedOnline]);
    mocks.startManagedDeviceForActivation.mockResolvedValue('online');

    const runtime = remoteDeviceRuntime.factory(context) as any;
    const result = await runtime.activateDevice({ deviceId: 'managed-a' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ metadata: { activeDeviceId: 'managed-a' } });
  });

  it('reports the device offline when it cannot be started', async () => {
    mocks.getScopedOnlineDevices.mockResolvedValue([managedAsleep]);
    mocks.startManagedDeviceForActivation.mockResolvedValue(undefined);

    const runtime = remoteDeviceRuntime.factory(context) as any;
    const result = await runtime.activateDevice({ deviceId: 'managed-a' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('listOnlineDevices');
  });
});
