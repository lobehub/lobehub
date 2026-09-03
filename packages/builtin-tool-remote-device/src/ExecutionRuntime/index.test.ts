import { describe, expect, it } from 'vitest';

import { RemoteDeviceExecutionRuntime } from './index';

const makeRuntime = (devices: any[]) =>
  new RemoteDeviceExecutionRuntime({
    queryDeviceList: async () => devices,
  });

describe('RemoteDeviceExecutionRuntime', () => {
  describe('listOnlineDevices', () => {
    it('filters offline devices and returns the online ones', async () => {
      const runtime = makeRuntime([
        { deviceId: 'd1', hostname: 'online-host', online: true, platform: 'darwin' },
        { deviceId: 'd2', hostname: 'offline-host', online: false, platform: 'win32' },
      ]);

      const result = await runtime.listOnlineDevices();

      expect(result.success).toBe(true);
      expect(JSON.parse(result.content)).toEqual([expect.objectContaining({ deviceId: 'd1' })]);
    });

    it('returns an actionable hint when no devices are online', async () => {
      const runtime = makeRuntime([
        { deviceId: 'd2', hostname: 'offline-host', online: false, platform: 'win32' },
      ]);

      const result = await runtime.listOnlineDevices();

      expect(result.success).toBe(true);
      expect(result.content).toContain('desktop application');
    });
  });

  describe('activateDevice', () => {
    it('activates an online device and returns metadata.activeDeviceId', async () => {
      const runtime = makeRuntime([
        { deviceId: 'd1', hostname: 'host', online: true, platform: 'darwin' },
      ]);

      const result = await runtime.activateDevice({ deviceId: 'd1' });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({
        metadata: { activeDeviceId: 'd1' },
      });
    });

    it('returns a refresh-list recovery hint when the device is not online (stale list)', async () => {
      const runtime = makeRuntime([
        // The device the model saw as "online" moments ago is now gone — the
        // stale-list race. The error must point at listOnlineDevices, not be a
        // dead end that invites blind retries.
        { deviceId: 'd1', hostname: 'host', online: false, platform: 'darwin' },
      ]);

      const result = await runtime.activateDevice({ deviceId: 'd1' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('not online or does not exist');
      expect(result.content).toContain('listOnlineDevices');
      expect(result.content).toContain('desktop application or cli');
    });

    it('returns the same recovery hint for an unknown device id', async () => {
      const runtime = makeRuntime([]);

      const result = await runtime.activateDevice({ deviceId: 'ghost' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('listOnlineDevices');
    });
  });
});
