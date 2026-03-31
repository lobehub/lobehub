import {
  RemoteDeviceExecutionRuntime,
  RemoteDeviceIdentifier,
} from '@lobechat/builtin-tool-remote-device';
import { describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

// Mock deviceProxy
const mockQueryDeviceList = vi.fn();
vi.mock('../../deviceProxy', () => ({
  deviceProxy: {
    queryDeviceList: (...args: any[]) => mockQueryDeviceList(...args),
  },
}));

// Import after mock setup
const { remoteDeviceRuntime } = await import('../remoteDevice');

describe('remoteDeviceRuntime', () => {
  it('should have the correct identifier', () => {
    expect(remoteDeviceRuntime.identifier).toBe(RemoteDeviceIdentifier);
  });

  describe('factory', () => {
    it('should throw when userId is missing', () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
      };

      expect(() => remoteDeviceRuntime.factory(context)).toThrow(
        'userId is required for Remote Device execution',
      );
    });

    it('should return a RemoteDeviceExecutionRuntime instance', () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
        userId: 'user-1',
      };

      const runtime = remoteDeviceRuntime.factory(context);

      expect(runtime).toBeInstanceOf(RemoteDeviceExecutionRuntime);
    });

    it('should pass queryDeviceList that calls deviceProxy with the userId', async () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
        userId: 'user-1',
      };

      const mockDevices = [
        {
          deviceId: 'd1',
          hostname: 'host1',
          lastSeen: '2024-01-01',
          online: true,
          platform: 'darwin',
        },
      ];
      mockQueryDeviceList.mockResolvedValue(mockDevices);

      const runtime = remoteDeviceRuntime.factory(context) as RemoteDeviceExecutionRuntime;

      // Call listOnlineDevices which internally calls queryDeviceList
      const result = await runtime.listOnlineDevices();

      expect(mockQueryDeviceList).toHaveBeenCalledWith('user-1');
      expect(result.success).toBe(true);
    });
  });
});
