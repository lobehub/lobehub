import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  awaitManagedDeviceForToolCall: vi.fn(),
  getScopedOnlineDevices: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { queryDeviceList: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: mocks.getScopedOnlineDevices,
}));

vi.mock('@/server/services/deviceGateway/managedDeviceWake', () => ({
  awaitManagedDeviceForToolCall: mocks.awaitManagedDeviceForToolCall,
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

describe('remoteDeviceRuntime — managed cloud devices', () => {
  it('wakes an offline managed device on activateDevice and reports DEVICE_WAKING', async () => {
    const waking = {
      content: 'starting',
      error: {
        code: 'DEVICE_WAKING',
        deviceId: 'managed-a',
        message: 'starting',
        retryAfterSeconds: 15,
      },
      success: false,
    };
    mocks.awaitManagedDeviceForToolCall.mockResolvedValue(waking);

    const runtime = remoteDeviceRuntime.factory(context) as any;
    const result = await runtime.activateDevice({ deviceId: 'managed-a' });

    expect(mocks.awaitManagedDeviceForToolCall).toHaveBeenCalledWith(
      { db: context.serverDB, userId: 'user-1', workspaceId: undefined },
      'managed-a',
    );
    expect(result).toEqual(waking);
  });

  it('activates the managed device when it comes online during the wait', async () => {
    mocks.getScopedOnlineDevices.mockResolvedValueOnce([]).mockResolvedValue([managedOnline]);
    mocks.awaitManagedDeviceForToolCall.mockResolvedValue('online');

    const runtime = remoteDeviceRuntime.factory(context) as any;
    const result = await runtime.activateDevice({ deviceId: 'managed-a' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ metadata: { activeDeviceId: 'managed-a' } });
  });
});
