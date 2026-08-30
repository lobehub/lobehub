/**
 * Tests for the client-side Remote Device executor — the path used when the
 * agent run executes in the browser (Agent Gateway disabled). The executor
 * relays device discovery to the server's `device.listDevices` tRPC, so a
 * previously "No executor found" → empty result now returns the online list.
 */
import { RemoteDeviceApiName } from '@lobechat/builtin-tool-remote-device';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type BuiltinToolContext } from '../../types';
import { remoteDeviceExecutor } from '../lobe-remote-device';

const mockListDevices = vi.fn();
const mockWorkspaceListDevices = vi.fn();

vi.mock('@/services/device', () => ({
  deviceService: {
    listDevices: (...args: any[]) => mockListDevices(...args),
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: (workspaceId: string) => ({
    device: {
      listDevices: {
        query: (...args: any[]) => mockWorkspaceListDevices(workspaceId, ...args),
      },
    },
  }),
}));

const mockAgentMap: Record<string, { workspaceId?: string | null }> = {};

vi.mock('@/store/agent', () => ({
  useAgentStore: {
    getState: () => ({ agentMap: mockAgentMap }),
  },
}));

let mockLocalDeviceId: string | undefined = 'dev-local';

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({
    gatewayDeviceInfo: mockLocalDeviceId ? { deviceId: mockLocalDeviceId } : undefined,
  }),
}));
describe('RemoteDeviceExecutor', () => {
  const createContext = (overrides?: Partial<BuiltinToolContext>): BuiltinToolContext => ({
    messageId: 'test-message-id',
    operationId: 'test-operation-id',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockAgentMap)) delete mockAgentMap[key];
    mockLocalDeviceId = 'dev-local';
  });

  describe('identifier', () => {
    it('should have correct identifier', () => {
      expect(remoteDeviceExecutor.identifier).toBe('lobe-remote-device');
    });
  });

  describe('hasApi', () => {
    it('should support the remote-device APIs', () => {
      expect(remoteDeviceExecutor.hasApi(RemoteDeviceApiName.listOnlineDevices)).toBe(true);
      expect(remoteDeviceExecutor.hasApi(RemoteDeviceApiName.activateDevice)).toBe(true);
      expect(remoteDeviceExecutor.hasApi('nope')).toBe(false);
    });
  });

  describe('listOnlineDevices', () => {
    it('returns the online devices from device.listDevices (client mode)', async () => {
      mockAgentMap['agt-personal'] = {};
      mockListDevices.mockResolvedValue([
        {
          channels: [
            {
              channel: 'desktop',
              connectedAt: '2026-08-06T10:00:00.000Z',
              hostname: 'Saturn',
              platform: 'win32',
            },
          ],
          defaultCwd: null,
          deviceId: 'dev-1',
          enroller: null,
          friendlyName: 'My Mac',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-2',
          enroller: null,
          friendlyName: null,
          hostname: 'OfflineBox',
          identitySource: 'machine-id',
          lastSeen: '2026-07-01T10:00:00.000Z',
          online: false,
          platform: 'linux',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-personal' }),
      );

      expect(result.success).toBe(true);
      expect(mockListDevices).toHaveBeenCalledTimes(1);
      // Only the online device is surfaced to the model
      const parsed = JSON.parse(result.content!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        deviceId: 'dev-1',
        friendlyName: 'My Mac',
        hostname: 'Saturn',
        online: true,
        scope: 'personal',
      });
    });

    it('returns the no-devices message when the list is empty', async () => {
      mockAgentMap['agt-personal'] = {};
      mockListDevices.mockResolvedValue([]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-personal' }),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain('No online devices found');
    });

    it('surfaces a relay failure as a structured error', async () => {
      mockAgentMap['agt-personal'] = {};
      mockListDevices.mockRejectedValue(new Error('gateway unreachable'));

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-personal' }),
      );

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to list devices');
      expect(result.error?.message).toBe('gateway unreachable');
    });

    it('filters the union list down to the personal pool for a personal agent', async () => {
      mockAgentMap['agt-personal'] = {};
      mockListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-personal',
          enroller: null,
          friendlyName: 'Saturn',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-ws',
          enroller: null,
          friendlyName: 'WorkspaceBox',
          hostname: 'WorkspaceBox',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'linux',
          registered: true,
          scope: 'workspace',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-personal' }),
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({ deviceId: 'dev-personal', scope: 'personal' });
    });

    it('scopes a workspace agent to the workspace pool only', async () => {
      mockAgentMap['agt-ws'] = { workspaceId: 'ws_01J' };
      mockWorkspaceListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-personal',
          enroller: null,
          friendlyName: 'Saturn',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-ws',
          enroller: null,
          friendlyName: 'WorkspaceBox',
          hostname: 'WorkspaceBox',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'linux',
          registered: true,
          scope: 'workspace',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-ws' }),
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({ deviceId: 'dev-ws', scope: 'workspace' });
      // The union query is pinned to the agent's workspace, not the UI-active one
      expect(mockWorkspaceListDevices).toHaveBeenCalledWith('ws_01J');
      expect(mockListDevices).not.toHaveBeenCalled();
    });

    it('fails closed when the agent is unknown to the store (no personal fallback)', async () => {
      mockListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-personal',
          enroller: null,
          friendlyName: 'Saturn',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-not-loaded' }),
      );

      // An unhydrated agent cannot prove which pool this run belongs to, so the
      // executor fails closed instead of leaking the personal pool into a
      // possibly-workspace conversation.
      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to list devices');
      expect(result.content).toContain('Cannot resolve the device scope');
      expect(mockListDevices).not.toHaveBeenCalled();
    });

    it('treats an empty-string workspaceId as personal', async () => {
      mockAgentMap['agt-empty-ws'] = { workspaceId: '' };
      mockListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-personal',
          enroller: null,
          friendlyName: 'Saturn',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-empty-ws' }),
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.content!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({ deviceId: 'dev-personal' });
      expect(mockWorkspaceListDevices).not.toHaveBeenCalled();
    });

    it('keeps scopes isolated across overlapping invokes (Promise.all)', async () => {
      mockAgentMap['agt-personal'] = {};
      mockAgentMap['agt-ws'] = { workspaceId: 'ws_01J' };
      mockListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-personal',
          enroller: null,
          friendlyName: 'Saturn',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
      ]);
      mockWorkspaceListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-ws',
          enroller: null,
          friendlyName: 'WorkspaceBox',
          hostname: 'WorkspaceBox',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'linux',
          registered: true,
          scope: 'workspace',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const [personalResult, wsResult] = await Promise.all([
        remoteDeviceExecutor.invoke(
          RemoteDeviceApiName.listOnlineDevices,
          {},
          createContext({ agentId: 'agt-personal' }),
        ),
        remoteDeviceExecutor.invoke(
          RemoteDeviceApiName.listOnlineDevices,
          {},
          createContext({ agentId: 'agt-ws' }),
        ),
      ]);

      expect(JSON.parse(personalResult.content!)).toMatchObject([{ deviceId: 'dev-personal' }]);
      expect(JSON.parse(wsResult.content!)).toMatchObject([{ deviceId: 'dev-ws' }]);
      // Each pool key fetched exactly once despite the overlapping invokes
      expect(mockListDevices).toHaveBeenCalledTimes(1);
      expect(mockWorkspaceListDevices).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight union query across same-pool invokes', async () => {
      mockAgentMap['agt-a'] = {};
      mockAgentMap['agt-b'] = {};
      mockListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-personal',
          enroller: null,
          friendlyName: 'Saturn',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const [a, b] = await Promise.all([
        remoteDeviceExecutor.invoke(
          RemoteDeviceApiName.listOnlineDevices,
          {},
          createContext({ agentId: 'agt-a' }),
        ),
        remoteDeviceExecutor.invoke(
          RemoteDeviceApiName.listOnlineDevices,
          {},
          createContext({ agentId: 'agt-b' }),
        ),
      ]);

      expect(a.success).toBe(true);
      expect(b.success).toBe(true);
      expect(mockListDevices).toHaveBeenCalledTimes(1);
    });

    it('refetches after a failed union query', async () => {
      mockAgentMap['agt-personal'] = {};
      mockListDevices
        .mockRejectedValueOnce(new Error('gateway unreachable'))
        .mockResolvedValueOnce([]);

      const failed = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-personal' }),
      );
      expect(failed.success).toBe(false);

      const retried = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.listOnlineDevices,
        {},
        createContext({ agentId: 'agt-personal' }),
      );
      expect(retried.success).toBe(true);
      expect(retried.content).toContain('No online devices found');
      // The failed in-flight entry was dropped, so the retry hit the server again
      expect(mockListDevices).toHaveBeenCalledTimes(2);
    });
  });

  describe('activateDevice', () => {
    it('activates an online device by id', async () => {
      mockAgentMap['agt-personal'] = {};
      mockLocalDeviceId = 'dev-1';
      mockListDevices.mockResolvedValue([
        {
          channels: [
            {
              channel: 'desktop',
              connectedAt: '2026-08-06T10:00:00.000Z',
              hostname: 'Saturn',
              platform: 'win32',
            },
          ],
          defaultCwd: null,
          deviceId: 'dev-1',
          enroller: null,
          friendlyName: 'My Mac',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.activateDevice,
        { deviceId: 'dev-1' },
        createContext({ agentId: 'agt-personal' }),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain('My Mac');
      expect(result.state).toMatchObject({ metadata: { activeDeviceId: 'dev-1' } });
      // The activation must reach the client runtime's tool-activation contract
      // so lobe-local-system is injected into the next client-mode LLM call
      // (mirrors the server's activeDeviceId → buildStepToolDelta fold).
      expect(result.state).toMatchObject({
        activatedTools: [{ identifier: 'lobe-local-system' }],
      });
    });

    it('refuses to activate a personal device from a workspace agent run', async () => {
      mockAgentMap['agt-ws'] = { workspaceId: 'ws_01J' };
      mockWorkspaceListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-personal',
          enroller: null,
          friendlyName: 'Saturn',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.activateDevice,
        { deviceId: 'dev-personal' },
        createContext({ agentId: 'agt-ws' }),
      );

      expect(result.success).toBe(false);
      expect(result.content).toContain('not online or does not exist');
    });

    it('refuses to activate a non-local device even when it is in the workspace pool', async () => {
      mockAgentMap['agt-ws'] = { workspaceId: 'ws_01J' };
      mockLocalDeviceId = 'dev-local';
      mockWorkspaceListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-ws',
          enroller: null,
          friendlyName: 'WorkspaceBox',
          hostname: 'WorkspaceBox',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'linux',
          registered: true,
          scope: 'workspace',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.activateDevice,
        { deviceId: 'dev-ws' },
        createContext({ agentId: 'agt-ws' }),
      );

      // Client-mode Local System only runs on the current desktop, so a
      // workspace-pool device that is not the local client cannot be activated
      // in browser-run mode (remote devices need Agent Gateway mode).
      expect(result.success).toBe(false);
      expect(result.content).toContain('not the current desktop client');
      expect(result.state).toBeUndefined();
    });

    it('refuses to activate a device when there is no connected desktop client', async () => {
      mockAgentMap['agt-personal'] = {};
      mockLocalDeviceId = undefined;
      mockListDevices.mockResolvedValue([
        {
          channels: [],
          defaultCwd: null,
          deviceId: 'dev-1',
          enroller: null,
          friendlyName: 'My Mac',
          hostname: 'Saturn',
          identitySource: 'machine-id',
          lastSeen: '2026-08-06T10:00:00.000Z',
          online: true,
          platform: 'win32',
          registered: true,
          scope: 'personal',
          visibility: null,
          workingDirs: [],
        },
      ]);

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.activateDevice,
        { deviceId: 'dev-1' },
        createContext({ agentId: 'agt-personal' }),
      );

      expect(result.success).toBe(false);
      expect(result.content).toContain('without a connected desktop client');
      expect(result.state).toBeUndefined();
    });

    it('surfaces a relay failure on activateDevice as a structured error', async () => {
      mockAgentMap['agt-personal'] = {};
      mockListDevices.mockRejectedValue(new Error('gateway unreachable'));

      const result = await remoteDeviceExecutor.invoke(
        RemoteDeviceApiName.activateDevice,
        { deviceId: 'dev-1' },
        createContext({ agentId: 'agt-personal' }),
      );

      expect(result.success).toBe(false);
      expect(result.content).toContain('Failed to activate device');
      expect(result.error?.message).toBe('gateway unreachable');
    });
  });
});
