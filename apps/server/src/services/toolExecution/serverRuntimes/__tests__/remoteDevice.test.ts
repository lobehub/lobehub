import {
  RemoteDeviceExecutionRuntime,
  RemoteDeviceIdentifier,
} from '@lobechat/builtin-tool-remote-device';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

// Mock deviceGateway
const mockQueryDeviceList = vi.fn();
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    queryDeviceList: (...args: any[]) => mockQueryDeviceList(...args),
  },
}));

// Import after mock setup
const { remoteDeviceRuntime } = await import('../remoteDevice');

beforeEach(() => {
  mockQueryDeviceList.mockReset();
});

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

    it('should query only the personal pool when no workspaceId is in context', async () => {
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

      const result = await runtime.listOnlineDevices();

      expect(mockQueryDeviceList).toHaveBeenCalledTimes(1);
      expect(mockQueryDeviceList).toHaveBeenCalledWith('user-1');
      expect(result.success).toBe(true);
    });

    it('should merge personal + workspace pools when workspaceId is in context', async () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'ws-1',
      };

      const personalDevice = {
        deviceId: 'd-personal',
        hostname: 'laptop',
        lastSeen: '2024-01-01',
        online: true,
        platform: 'darwin',
      };
      const workspaceDevice = {
        deviceId: 'd-workspace',
        hostname: 'shared-mac',
        lastSeen: '2024-01-01',
        online: true,
        platform: 'darwin',
      };

      mockQueryDeviceList.mockImplementation((_userId: string, wsId?: string) =>
        Promise.resolve(wsId ? [workspaceDevice] : [personalDevice]),
      );

      const runtime = remoteDeviceRuntime.factory(context) as RemoteDeviceExecutionRuntime;

      const result = await runtime.listOnlineDevices();

      expect(mockQueryDeviceList).toHaveBeenCalledTimes(2);
      expect(mockQueryDeviceList).toHaveBeenCalledWith('user-1');
      expect(mockQueryDeviceList).toHaveBeenCalledWith('user-1', 'ws-1');
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content);
      expect(parsed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ deviceId: 'd-personal' }),
          expect.objectContaining({ deviceId: 'd-workspace' }),
        ]),
      );
    });
  });
});
