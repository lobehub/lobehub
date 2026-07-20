import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectExecutionTarget } from './useSelectExecutionTarget';

const testState = vi.hoisted(() => ({
  agent: {
    agencyConfig: undefined as
      | {
          boundDeviceId?: string;
          executionTargetSelectionPolicy?: 'fixed' | 'member';
          executionTarget?: string;
          heterogeneousProvider?: { type: string };
        }
      | undefined,
    agentMap: {} as Record<string, { workspaceId?: string | null }>,
    isHetero: false,
    updateAgentConfigById: vi.fn(),
  },
  electron: {
    gatewayDeviceInfo: undefined as { deviceId?: string } | undefined,
  },
  getDeviceInfo: vi.fn(),
  isDesktop: false,
  user: {
    updateWorkspaceUserPreference: vi.fn(),
    workspaceUserPreference: {} as {
      agentDeviceOverrides?: Record<string, { boundDeviceId?: string; executionTarget?: string }>;
    },
  },
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return testState.isDesktop;
  },
}));

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: {
    getDeviceInfo: () => testState.getDeviceInfo(),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof testState.agent) => unknown) => selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => (s: typeof testState.agent) => s.agencyConfig,
    isAgentHeterogeneousById: () => (s: typeof testState.agent) => s.isHetero,
  },
}));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (s: typeof testState.electron) => unknown) =>
    selector(testState.electron),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: typeof testState.user) => unknown) => selector(testState.user),
}));

describe('useSelectExecutionTarget', () => {
  beforeEach(() => {
    testState.agent.agencyConfig = undefined;
    testState.agent.agentMap = {};
    testState.agent.isHetero = false;
    testState.agent.updateAgentConfigById = vi.fn();
    testState.electron.gatewayDeviceInfo = undefined;
    testState.getDeviceInfo = vi.fn();
    testState.isDesktop = false;
    testState.user.workspaceUserPreference = {};
    testState.user.updateWorkspaceUserPreference = vi.fn();
  });

  describe('personal agent — writes to the shared agencyConfig', () => {
    it('persists the target as-is when switching to sandbox, keeping any existing boundDeviceId', async () => {
      testState.agent.agencyConfig = { boundDeviceId: 'device-1', executionTarget: 'local' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-id', {
        agencyConfig: { boundDeviceId: 'device-1', executionTarget: 'sandbox' },
      });
      expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    });

    it('pins the given deviceId when switching to a specific device', async () => {
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('device', 'device-2');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-id', {
        agencyConfig: { boundDeviceId: 'device-2', executionTarget: 'device' },
      });
    });

    it("stores 'local' verbatim (not pre-resolved to 'device') to preserve the in-process IPC path", async () => {
      testState.isDesktop = true;
      testState.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.getDeviceInfo).not.toHaveBeenCalled();
      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-id', {
        agencyConfig: { boundDeviceId: 'this-machine', executionTarget: 'local' },
      });
    });

    it('falls back to the gateway connection service when no gateway deviceId is cached yet', async () => {
      testState.isDesktop = true;
      testState.getDeviceInfo.mockResolvedValue({ deviceId: 'resolved-device' });
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.getDeviceInfo).toHaveBeenCalled();
      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-id', {
        agencyConfig: { boundDeviceId: 'resolved-device', executionTarget: 'local' },
      });
    });

    it('keeps the previous boundDeviceId when the local device cannot be resolved for a non-hetero agent', async () => {
      testState.agent.agencyConfig = { boundDeviceId: 'stale-device', executionTarget: 'sandbox' };
      testState.getDeviceInfo.mockRejectedValue(new Error('no gateway'));
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-id', {
        agencyConfig: { boundDeviceId: 'stale-device', executionTarget: 'local' },
      });
    });

    it('does not switch a heterogeneous agent to local when no device can be resolved', async () => {
      testState.agent.isHetero = true;
      testState.getDeviceInfo.mockRejectedValue(new Error('no gateway'));
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
      expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    });
  });

  describe('workspace agent — writes to workspace_user_settings.preference.agentDeviceOverrides (LOBE-11689)', () => {
    beforeEach(() => {
      testState.agent.agentMap = { 'agent-id': { workspaceId: 'ws-1' } };
    });

    it('routes a workspace device pick into the workspace-scoped caller preference, never the shared config', async () => {
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('device', 'ws-device-1');

      expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: {
          'agent-id': { boundDeviceId: 'ws-device-1', executionTarget: 'device' },
        },
      });
      expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
    });

    it('does not write a member override while the shared execution target is fixed', async () => {
      testState.agent.agencyConfig = {
        boundDeviceId: 'fixed-device',
        executionTargetSelectionPolicy: 'fixed',
        executionTarget: 'device',
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('device', 'another-device');

      expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
      expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
    });

    it("accepts 'local' for a workspace agent and stores it in the workspace-scoped preference", async () => {
      testState.isDesktop = true;
      testState.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: {
          'agent-id': { boundDeviceId: 'this-machine', executionTarget: 'local' },
        },
      });
      expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
    });

    it('preserves other agents overrides in the same workspace when writing this one', async () => {
      testState.user.workspaceUserPreference = {
        agentDeviceOverrides: {
          'other-agent': { boundDeviceId: 'other-device', executionTarget: 'device' },
        },
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: {
          'other-agent': { boundDeviceId: 'other-device', executionTarget: 'device' },
          'agent-id': { executionTarget: 'sandbox' },
        },
      });
    });

    it('drops boundDeviceId when it cannot be resolved (e.g. web caller picks local)', async () => {
      testState.isDesktop = false;
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: { 'agent-id': { executionTarget: 'sandbox' } },
      });
    });
  });
});
