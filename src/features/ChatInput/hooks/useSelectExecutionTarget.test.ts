import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectExecutionTarget } from './useSelectExecutionTarget';

const state = vi.hoisted(() => ({
  access: { canManageAgent: true },
  agent: {
    agencyConfig: undefined as
      | {
          boundDeviceId?: string;
          executionTarget?: string;
          executionTargetSelectionPolicy?: 'fixed' | 'member';
          heterogeneousProvider?: { type: string };
          localSandbox?: boolean;
        }
      | undefined,
    agentMap: {} as Record<
      string,
      { visibility?: 'private' | 'public'; workspaceId?: string | null }
    >,
    isHetero: false,
    updateAgentConfigById: vi.fn(),
  },
  chat: {
    activeAgentId: 'agent-id',
    activeTopicId: 'topic-a' as string | undefined,
    createTopic: vi.fn(),
    updateTopicMetadata: vi.fn(),
    switchTopic: vi.fn(),
  },
  desktop: false,
  deviceInfo: vi.fn(),
  electron: { gatewayDeviceInfo: undefined as { deviceId?: string } | undefined },
  topicConfig: {
    agencyConfig: { executionTarget: 'local', boundDeviceId: 'device-a' } as {
      boundDeviceId?: string;
      executionTarget?: string;
      localSandbox?: boolean;
    },
    canSelectExecutionTarget: true,
  },
  toast: vi.fn(),
  user: {
    updateWorkspaceUserPreference: vi.fn(),
    workspaceUserPreference: {} as {
      agentDeviceOverrides?: Record<
        string,
        { boundDeviceId?: string; executionTarget?: string; localSandbox?: boolean }
      >;
    },
  },
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return state.desktop;
  },
}));
vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: state.toast } }));
vi.mock('i18next', () => ({ t: (key: string) => key }));
vi.mock('@/features/ResourcePermission/useAgentManagementAccess', () => ({
  useAgentManagementAccess: () => state.access,
}));
vi.mock('@/hooks/useTopicAgencyConfig', () => ({
  useTopicAgencyConfig: () => state.topicConfig,
}));
vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: () => state.deviceInfo() },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof state.agent) => unknown) => selector(state.agent),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => (s: typeof state.agent) => s.agencyConfig,
    isAgentHeterogeneousById: () => (s: typeof state.agent) => s.isHetero,
  },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof state.chat) => unknown) => selector(state.chat),
    { getState: () => state.chat },
  ),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: typeof state.electron) => unknown) => selector(state.electron),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: typeof state.user) => unknown) => selector(state.user),
}));

describe('useSelectExecutionTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.access.canManageAgent = true;
    state.agent.agencyConfig = undefined;
    state.agent.agentMap = {};
    state.agent.isHetero = false;
    state.agent.updateAgentConfigById = vi.fn();
    state.chat.activeAgentId = 'agent-id';
    state.chat.activeTopicId = 'topic-a';
    state.chat.updateTopicMetadata.mockResolvedValue(undefined);
    state.desktop = false;
    state.electron.gatewayDeviceInfo = undefined;
    state.topicConfig.agencyConfig = {
      executionTarget: 'local',
      boundDeviceId: 'device-a',
    };
    state.topicConfig.canSelectExecutionTarget = true;
    state.user.updateWorkspaceUserPreference = vi.fn();
    state.user.workspaceUserPreference = {};
  });

  describe('inside an existing Topic', () => {
    it('updates only the captured Topic execution config', async () => {
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.chat.updateTopicMetadata).toHaveBeenCalledWith('topic-a', {
        executionConfig: {
          executionTarget: 'sandbox',
          inheritWorkspaceScope: false,
          boundDeviceId: undefined,
          localSandbox: undefined,
          localSandboxNetwork: undefined,
        },
      });
      expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
      expect(state.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
      expect(state.chat.createTopic).not.toHaveBeenCalled();
    });

    it('does not redirect a delayed device selection to another Topic', async () => {
      let resolve!: (value: { deviceId: string }) => void;
      state.deviceInfo.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      const selection = result.current('local');
      state.chat.activeTopicId = 'topic-b';
      resolve({ deviceId: 'device-a' });
      await selection;

      expect(state.chat.updateTopicMetadata).toHaveBeenCalledWith(
        'topic-a',
        expect.objectContaining({
          executionConfig: expect.objectContaining({ boundDeviceId: 'device-a' }),
        }),
      );
    });

    it('uses the Topic-specific failure message', async () => {
      state.chat.updateTopicMetadata.mockRejectedValue(new Error('network'));
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.toast).toHaveBeenCalledWith('saveTopicExecutionConfigFail');
    });
  });

  describe('from an Agent entry without a Topic', () => {
    beforeEach(() => {
      state.chat.activeTopicId = undefined;
    });

    it('updates a personal Agent default without creating a Topic', async () => {
      state.agent.agencyConfig = { boundDeviceId: 'device-a', executionTarget: 'local' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        { agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'sandbox' } },
        { rethrow: true },
      );
      expect(state.chat.createTopic).not.toHaveBeenCalled();
      expect(state.chat.updateTopicMetadata).not.toHaveBeenCalled();
      expect(state.chat.switchTopic).not.toHaveBeenCalled();
    });

    it('keeps automatic defaults on the Agent and suppresses their failure toast', async () => {
      state.desktop = true;
      state.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local', undefined, { silent: true });

      expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        { agencyConfig: { boundDeviceId: 'this-machine', executionTarget: 'local' } },
        { rethrow: true, showErrorMessage: false },
      );
      expect(state.chat.createTopic).not.toHaveBeenCalled();
    });

    it('writes a public Workspace member selection to their Agent override', async () => {
      state.access.canManageAgent = false;
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.user.workspaceUserPreference = {
        agentDeviceOverrides: { 'other-agent': { executionTarget: 'sandbox' } },
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('device', 'workspace-device');

      expect(state.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: {
          'agent-id': { boundDeviceId: 'workspace-device', executionTarget: 'device' },
        },
      });
      expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
      expect(state.chat.createTopic).not.toHaveBeenCalled();
    });

    it('does not let a Workspace member override a fixed Agent default', async () => {
      state.access.canManageAgent = false;
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.agent.agencyConfig = {
        boundDeviceId: 'fixed-device',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      };
      state.topicConfig.canSelectExecutionTarget = false;
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
      expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
      expect(state.chat.createTopic).not.toHaveBeenCalled();
    });

    it('does not save while the effective execution selector is unavailable', async () => {
      state.topicConfig.canSelectExecutionTarget = false;
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
      expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
    });

    it('writes a Workspace manager shared selection to the Agent default', async () => {
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('device', 'workspace-device');

      expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        { agencyConfig: { boundDeviceId: 'workspace-device', executionTarget: 'device' } },
        { rethrow: true },
      );
      expect(state.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
      expect(state.chat.createTopic).not.toHaveBeenCalled();
    });

    it("keeps a Workspace manager's local machine in their Agent override", async () => {
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.desktop = true;
      state.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(state.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: {
          'agent-id': { boundDeviceId: 'this-machine', executionTarget: 'local' },
        },
      });
      expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
    });

    it("keeps a Workspace manager's dormant sandbox settings in their Agent override", async () => {
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.user.workspaceUserPreference = {
        agentDeviceOverrides: { 'agent-id': { localSandbox: false } },
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox', undefined, {
        localSandbox: true,
        localSandboxNetwork: true,
      });

      expect(state.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: {
          'agent-id': { localSandbox: true, localSandboxNetwork: true },
        },
      });
      expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
    });

    it("clears a Workspace manager's stale routing override after changing the shared default", async () => {
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.user.workspaceUserPreference = {
        agentDeviceOverrides: {
          'agent-id': {
            boundDeviceId: 'this-machine',
            executionTarget: 'local',
            localSandbox: true,
          },
        },
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: { 'agent-id': { localSandbox: true } },
      });
      expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        { agencyConfig: { executionTarget: 'sandbox' } },
        { rethrow: true },
      );
      expect(state.user.updateWorkspaceUserPreference.mock.invocationCallOrder[0]).toBeLessThan(
        state.agent.updateAgentConfigById.mock.invocationCallOrder[0],
      );
    });

    it("restores a Workspace manager's routing override when the shared save fails", async () => {
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.user.workspaceUserPreference = {
        agentDeviceOverrides: {
          'agent-id': {
            boundDeviceId: 'this-machine',
            executionTarget: 'local',
            localSandbox: true,
          },
        },
      };
      state.agent.updateAgentConfigById.mockRejectedValue(new Error('network'));
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.user.updateWorkspaceUserPreference).toHaveBeenNthCalledWith(1, {
        agentDeviceOverrides: { 'agent-id': { localSandbox: true } },
      });
      expect(state.user.updateWorkspaceUserPreference).toHaveBeenNthCalledWith(2, {
        agentDeviceOverrides: {
          'agent-id': {
            boundDeviceId: 'this-machine',
            executionTarget: 'local',
            localSandbox: true,
          },
        },
      });
    });

    it('does not change the shared default when clearing a manager override fails', async () => {
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.user.workspaceUserPreference = {
        agentDeviceOverrides: {
          'agent-id': { boundDeviceId: 'this-machine', executionTarget: 'local' },
        },
      };
      state.user.updateWorkspaceUserPreference.mockRejectedValue(new Error('network'));
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
      expect(state.toast).toHaveBeenCalledWith('saveAgentConfigFail');
    });

    it('serializes rapid Workspace manager shared-default selections', async () => {
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.user.workspaceUserPreference = {
        agentDeviceOverrides: {
          'agent-id': { boundDeviceId: 'this-machine', executionTarget: 'local' },
        },
      };
      let resolveFirst!: () => void;
      state.agent.updateAgentConfigById
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      const firstSelection = result.current('sandbox');
      await vi.waitFor(() => expect(state.agent.updateAgentConfigById).toHaveBeenCalledTimes(1));

      const secondSelection = result.current('device', 'workspace-device');
      await Promise.resolve();
      expect(state.agent.updateAgentConfigById).toHaveBeenCalledTimes(1);

      resolveFirst();
      await Promise.all([firstSelection, secondSelection]);

      expect(state.agent.updateAgentConfigById).toHaveBeenNthCalledWith(
        2,
        'agent-id',
        { agencyConfig: { boundDeviceId: 'workspace-device', executionTarget: 'device' } },
        { rethrow: true },
      );
      expect(state.user.updateWorkspaceUserPreference).toHaveBeenCalledTimes(2);
    });

    it('reports an Agent-setting failure when a Workspace member override cannot be saved', async () => {
      state.access.canManageAgent = false;
      state.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'workspace-id' },
      };
      state.user.updateWorkspaceUserPreference.mockRejectedValue(new Error('network'));
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(state.toast).toHaveBeenCalledWith('saveAgentConfigFail');
      expect(state.chat.createTopic).not.toHaveBeenCalled();
    });

    it('does not save after device discovery if the user has entered a Topic', async () => {
      state.desktop = true;
      let resolve!: (value: { deviceId: string }) => void;
      state.deviceInfo.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      const selection = result.current('local');
      state.chat.activeTopicId = 'topic-b';
      resolve({ deviceId: 'device-a' });
      await selection;

      expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
      expect(state.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
      expect(state.chat.createTopic).not.toHaveBeenCalled();
    });
  });
});
