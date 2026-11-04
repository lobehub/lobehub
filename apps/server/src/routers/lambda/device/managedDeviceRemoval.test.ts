// @vitest-environment node
import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportManagedDevicesRemoved } from './managedDeviceRemoval';

const mocks = vi.hoisted(() => ({
  onManagedDeviceRemoved: vi.fn(),
}));

vi.mock('@/business/server/managedDevice', () => ({
  onManagedDeviceRemoved: mocks.onManagedDeviceRemoved,
}));

const managed = (deviceId: string, workspaceId: string | null = null) => ({
  deviceId,
  identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
  userId: 'user-1',
  workspaceId,
});

describe('reportManagedDevicesRemoved', () => {
  beforeEach(() => {
    mocks.onManagedDeviceRemoved.mockReset().mockResolvedValue(undefined);
  });

  it('reports a removed personal managed device without a workspace', async () => {
    await reportManagedDevicesRemoved([managed('managed-1')]);

    expect(mocks.onManagedDeviceRemoved).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'managed-1',
      userId: 'user-1',
    });
  });

  it('reports the workspace of a removed workspace managed device', async () => {
    await reportManagedDevicesRemoved([managed('managed-1', 'workspace-1')]);

    expect(mocks.onManagedDeviceRemoved).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'managed-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
  });

  it('does not report connected devices or an empty removal', async () => {
    await reportManagedDevicesRemoved([
      { deviceId: 'laptop', identitySource: 'machine-id', userId: 'user-1', workspaceId: null },
      { deviceId: 'box', identitySource: 'fallback', userId: 'user-1', workspaceId: null },
    ]);
    await reportManagedDevicesRemoved([]);
    await reportManagedDevicesRemoved(undefined);

    expect(mocks.onManagedDeviceRemoved).not.toHaveBeenCalled();
  });

  it('logs a hook failure and still reports the other removed devices', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.onManagedDeviceRemoved.mockRejectedValueOnce(new Error('hook failed'));

    await expect(
      reportManagedDevicesRemoved([managed('managed-1'), managed('managed-2', 'workspace-1')]),
    ).resolves.toBeUndefined();

    expect(mocks.onManagedDeviceRemoved).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
