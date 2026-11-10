import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { MANAGED_DEVICE_WAKE_POLL, reconnectDevice } from '../reconnectDevice';

const managed = {
  deviceId: 'managed-a',
  identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
  scope: 'workspace' as const,
};
const desktop = { deviceId: 'desktop-a', identitySource: 'machine-id', scope: 'personal' as const };

const deps = (onlineAfter = 1) => {
  let calls = 0;
  return {
    connectGateway: vi.fn().mockResolvedValue(undefined),
    openDeepLink: vi.fn(),
    refreshDevices: vi.fn(async () => {
      calls += 1;
      return calls >= onlineAfter
        ? [
            { deviceId: 'managed-a', online: true },
            { deviceId: 'desktop-a', online: true },
          ]
        : [];
    }) as never,
    sleep: vi.fn().mockResolvedValue(undefined),
    wakeManagedDevice: vi.fn().mockResolvedValue({ success: true }),
  };
};

describe('reconnectDevice', () => {
  it('wakes a managed cloud device through the server, not the desktop deep link', async () => {
    const d = deps(3);

    await expect(reconnectDevice(managed, { isCurrentMachine: false }, d)).resolves.toBe(
      'connected',
    );
    expect(d.wakeManagedDevice).toHaveBeenCalledWith({ deviceId: 'managed-a', scope: 'workspace' });
    expect(d.openDeepLink).not.toHaveBeenCalled();
    expect(d.connectGateway).not.toHaveBeenCalled();
    // The list refresh is also what shows the device's new phase.
    expect(d.refreshDevices).toHaveBeenCalledTimes(3);
  });

  it('reports a managed device that is still starting after the wait', async () => {
    const d = deps(Number.POSITIVE_INFINITY);

    await expect(reconnectDevice(managed, { isCurrentMachine: false }, d)).resolves.toBe(
      'starting',
    );
    expect(d.refreshDevices).toHaveBeenCalledTimes(MANAGED_DEVICE_WAKE_POLL.attempts);
    expect(d.sleep).toHaveBeenCalledWith(MANAGED_DEVICE_WAKE_POLL.intervalMs);
  });

  it('keeps polling after a failed list refresh and reports the device online', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps();
    const refreshDevices = d.refreshDevices as unknown as ReturnType<typeof vi.fn>;
    refreshDevices.mockRejectedValueOnce(new Error('network'));

    await expect(reconnectDevice(managed, { isCurrentMachine: false }, d)).resolves.toBe(
      'connected',
    );
    expect(d.refreshDevices).toHaveBeenCalledTimes(2);
    expect(d.wakeManagedDevice).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('reports starting, not a failed wake, when every list refresh fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps();
    const refreshDevices = d.refreshDevices as unknown as ReturnType<typeof vi.fn>;
    refreshDevices.mockRejectedValue(new Error('network'));

    await expect(reconnectDevice(managed, { isCurrentMachine: false }, d)).resolves.toBe(
      'starting',
    );
    expect(d.refreshDevices).toHaveBeenCalledTimes(MANAGED_DEVICE_WAKE_POLL.attempts);
    expect(d.wakeManagedDevice).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('passes a refused wake to the caller', async () => {
    const d = deps();
    d.wakeManagedDevice.mockRejectedValue(new Error('refused'));

    await expect(reconnectDevice(managed, { isCurrentMachine: false }, d)).rejects.toThrow(
      'refused',
    );
    expect(d.openDeepLink).not.toHaveBeenCalled();
  });

  it('keeps the desktop deep link for a connected device', async () => {
    const d = deps();

    await expect(reconnectDevice(desktop, { isCurrentMachine: false }, d)).resolves.toBe(
      'connected',
    );
    expect(d.openDeepLink).toHaveBeenCalledWith('lobehub://device/reconnect?deviceId=desktop-a');
    expect(d.wakeManagedDevice).not.toHaveBeenCalled();
  });

  it("reconnects this desktop app's own gateway connection", async () => {
    const d = deps();

    await reconnectDevice(desktop, { isCurrentMachine: true }, d);
    expect(d.connectGateway).toHaveBeenCalledOnce();
    expect(d.openDeepLink).not.toHaveBeenCalled();
  });

  it('reports a connected device that did not come back', async () => {
    const d = deps(Number.POSITIVE_INFINITY);

    await expect(reconnectDevice(desktop, { isCurrentMachine: false }, d)).resolves.toBe('failed');
  });
});
