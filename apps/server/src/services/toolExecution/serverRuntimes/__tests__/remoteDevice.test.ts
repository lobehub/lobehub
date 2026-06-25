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

// Mock the DeviceModel so the runtime's DB-backed workspace lookup is observable.
const mockQueryWorkspaceDevices = vi.fn();
vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(() => ({
    queryWorkspaceDevices: mockQueryWorkspaceDevices,
  })),
}));

// Import after mock setup
const { remoteDeviceRuntime } = await import('../remoteDevice');

/** Minimal drizzle-like chain that resolves the agent's workspace_id lookup. */
const makeServerDB = (workspaceId: string | null) =>
  ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(workspaceId === null ? [] : [{ workspaceId }]),
        }),
      }),
    }),
  }) as any;

beforeEach(() => {
  mockQueryDeviceList.mockReset();
  mockQueryWorkspaceDevices.mockReset();
  mockQueryWorkspaceDevices.mockResolvedValue([]);
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

    it('recovers the workspace scope from the running agent when context.workspaceId is missing', async () => {
      const context: ToolExecutionContext = {
        agentId: 'agt-1',
        serverDB: makeServerDB('ws-1'),
        toolManifestMap: {},
        userId: 'user-1',
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

      // The recovered workspace id drives the workspace gateway pool query.
      expect(mockQueryDeviceList).toHaveBeenCalledWith('user-1', 'ws-1');
      const parsed = JSON.parse(result.content);
      expect(parsed).toEqual(
        expect.arrayContaining([expect.objectContaining({ deviceId: 'd-workspace' })]),
      );
    });

    it('stays personal-only when the running agent has no workspace', async () => {
      const context: ToolExecutionContext = {
        agentId: 'agt-personal',
        serverDB: makeServerDB(null),
        toolManifestMap: {},
        userId: 'user-1',
      };
      mockQueryDeviceList.mockResolvedValue([
        {
          deviceId: 'd-personal',
          hostname: 'laptop',
          lastSeen: '2024-01-01',
          online: true,
          platform: 'darwin',
        },
      ]);

      const runtime = remoteDeviceRuntime.factory(context) as RemoteDeviceExecutionRuntime;
      await runtime.listOnlineDevices();

      expect(mockQueryDeviceList).toHaveBeenCalledTimes(1);
      expect(mockQueryDeviceList).toHaveBeenCalledWith('user-1');
    });

    it('surfaces a DB-registered workspace device merged with gateway online status (no duplicate)', async () => {
      const context: ToolExecutionContext = {
        serverDB: makeServerDB('ws-1'),
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'ws-1',
      };

      const gatewayWorkspaceDevice = {
        deviceId: 'd-ws',
        hostname: 'shared-mac',
        lastSeen: '2024-01-02',
        online: true,
        platform: 'linux',
      };
      mockQueryDeviceList.mockImplementation((_userId: string, wsId?: string) =>
        Promise.resolve(wsId ? [gatewayWorkspaceDevice] : []),
      );
      mockQueryWorkspaceDevices.mockResolvedValue([
        {
          deviceId: 'd-ws',
          hostname: 'shared-mac',
          lastSeenAt: new Date('2024-01-01'),
          platform: 'linux',
        },
      ]);

      const runtime = remoteDeviceRuntime.factory(context) as RemoteDeviceExecutionRuntime;
      const result = await runtime.listOnlineDevices();

      const parsed = JSON.parse(result.content);
      const wsEntries = parsed.filter((d: { deviceId: string }) => d.deviceId === 'd-ws');
      expect(wsEntries).toHaveLength(1);
      expect(wsEntries[0]).toMatchObject({ deviceId: 'd-ws', online: true });
    });
  });
});
