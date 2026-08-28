import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelectExecutionTarget } from './useSelectExecutionTarget';

const testState = vi.hoisted(() => ({
  access: {
    canManageAgent: true,
    isAccessLoading: false,
  },
  agent: {
    agencyConfig: undefined as
      | {
          boundDeviceId?: string;
          executionTargetSelectionPolicy?: 'fixed' | 'member';
          executionTarget?: string;
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
  electron: {
    gatewayDeviceInfo: undefined as { deviceId?: string } | undefined,
  },
  getDeviceInfo: vi.fn(),
  isDesktop: false,
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
    return testState.isDesktop;
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('i18next', () => ({
  t: (key: string) => key,
}));

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: {
    getDeviceInfo: () => testState.getDeviceInfo(),
  },
}));

vi.mock('@/features/ResourcePermission/useAgentManagementAccess', () => ({
  useAgentManagementAccess: () => testState.access,
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
    testState.access.canManageAgent = true;
    testState.access.isAccessLoading = false;
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

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { boundDeviceId: 'device-1', executionTarget: 'sandbox' },
        },
        { rethrow: true },
      );
      expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    });

    it('pins the given deviceId when switching to a specific device', async () => {
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('device', 'device-2');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { boundDeviceId: 'device-2', executionTarget: 'device' },
        },
        { rethrow: true },
      );
    });

    it("stores 'local' verbatim (not pre-resolved to 'device') to preserve the in-process IPC path", async () => {
      testState.isDesktop = true;
      testState.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.getDeviceInfo).not.toHaveBeenCalled();
      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { boundDeviceId: 'this-machine', executionTarget: 'local' },
        },
        { rethrow: true },
      );
    });

    it('falls back to the gateway connection service when no gateway deviceId is cached yet', async () => {
      testState.isDesktop = true;
      testState.getDeviceInfo.mockResolvedValue({ deviceId: 'resolved-device' });
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.getDeviceInfo).toHaveBeenCalled();
      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { boundDeviceId: 'resolved-device', executionTarget: 'local' },
        },
        { rethrow: true },
      );
    });

    it('keeps the previous boundDeviceId when the local device cannot be resolved for a non-hetero agent', async () => {
      testState.agent.agencyConfig = { boundDeviceId: 'stale-device', executionTarget: 'sandbox' };
      testState.getDeviceInfo.mockRejectedValue(new Error('no gateway'));
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { boundDeviceId: 'stale-device', executionTarget: 'local' },
        },
        { rethrow: true },
      );
    });

    // automatic corrections must not trigger phantom save-error toasts: the device switcher defaults an unset target to `local` on
    // mount. In a workspace that write can be rejected (edit lock / resource
    // access), and the generic failure toast then claims the user's change was
    // not applied — on an agent they only opened, having changed nothing.
    it('suppresses the failure toast when the target is being defaulted automatically', async () => {
      testState.isDesktop = true;
      testState.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local', undefined, { silent: true });

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        { agencyConfig: { boundDeviceId: 'this-machine', executionTarget: 'local' } },
        { rethrow: true, showErrorMessage: false },
      );
    });

    it("keeps the failure toast for a user's own pick", async () => {
      testState.isDesktop = true;
      testState.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { boundDeviceId: 'this-machine', executionTarget: 'local' },
        },
        { rethrow: true },
      );
    });

    it('records the sandbox choice alongside a local pick', async () => {
      testState.isDesktop = true;
      testState.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local', undefined, { localSandbox: true });

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: {
            boundDeviceId: 'this-machine',
            executionTarget: 'local',
            localSandbox: true,
          },
        },
        { rethrow: true },
      );
    });

    it('clears the sandbox when the plain local row is picked', async () => {
      // Switching back has to be an explicit `false`, not an omission — a
      // leftover `true` would keep fencing a run the user just un-fenced.
      testState.isDesktop = true;
      testState.electron.gatewayDeviceInfo = { deviceId: 'this-machine' };
      testState.agent.agencyConfig = { executionTarget: 'local', localSandbox: true };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('local', undefined, { localSandbox: false });

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: {
            boundDeviceId: 'this-machine',
            executionTarget: 'local',
            localSandbox: false,
          },
        },
        { rethrow: true },
      );
    });

    it('leaves the stored sandbox choice dormant when switching to another environment', async () => {
      // Cloud Sandbox has no opinion about how the user's own machine is
      // fenced, so flipping away and back must not silently forget it.
      testState.agent.agencyConfig = { executionTarget: 'local', localSandbox: true };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { executionTarget: 'sandbox', localSandbox: true },
        },
        { rethrow: true },
      );
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

  describe('workspace agent — writes to workspace_user_settings.preference.agentDeviceOverrides ', () => {
    beforeEach(() => {
      testState.access.canManageAgent = false;
      testState.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'ws-1' },
      };
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

    it("keeps a member's own sandbox choice in their override when they switch environment", async () => {
      // One member fencing their own machine is theirs alone — it must live in
      // the per-user override and survive a target switch, never reach the
      // shared row where it would apply to everyone.
      testState.user.workspaceUserPreference = {
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

      expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: {
          'agent-id': {
            boundDeviceId: 'this-machine',
            executionTarget: 'sandbox',
            localSandbox: true,
          },
        },
      });
      expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
    });

    it('drops boundDeviceId when it cannot be resolved (e.g. web caller picks local)', async () => {
      testState.isDesktop = false;
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: { 'agent-id': { executionTarget: 'sandbox' } },
      });
    });

    it('lets the author or Workspace admin update the shared target while members are fixed', async () => {
      testState.access.canManageAgent = true;
      testState.agent.agencyConfig = {
        boundDeviceId: 'fixed-device',
        executionTargetSelectionPolicy: 'fixed',
        executionTarget: 'device',
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: {
            boundDeviceId: 'fixed-device',
            executionTarget: 'sandbox',
            executionTargetSelectionPolicy: 'fixed',
          },
        },
        { rethrow: true },
      );
      expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    });
  });

  describe("workspace agent — a manager's or owner's `local` pick stays per-user", () => {
    // The regression behind "用户在 Workspace 中无法切换个人的本地设备": a `local`
    // pick binds this member's PERSONAL desktop device, which the shared row
    // must never reference — the server rejects it with
    // `WorkspaceAgentRequiresWorkspaceDevice` and the picker surfaces
    // "Failed to save agent settings". So even callers who manage the shared
    // config route `local` into their per-user override.
    it("routes a manager's 'local' pick into the per-user override, never the shared config", async () => {
      testState.access.canManageAgent = true;
      testState.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'ws-1' },
      };
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

    it("routes a private Workspace agent owner's 'local' pick into the per-user override", async () => {
      testState.agent.agentMap = {
        'agent-id': { visibility: 'private', workspaceId: 'ws-1' },
      };
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

    it("clears the manager's own routing override when they pick a shared target", async () => {
      // Without this, the earlier `local` override would keep shadowing the
      // shared target the manager just wrote. The sandbox fence stays dormant —
      // it qualifies their machine, not this pick.
      testState.access.canManageAgent = true;
      testState.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'ws-1' },
      };
      testState.user.workspaceUserPreference = {
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

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { executionTarget: 'sandbox' },
        },
        { rethrow: true },
      );
      expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
        agentDeviceOverrides: {
          'agent-id': { localSandbox: true },
        },
      });
    });

    it('keeps the routing override intact when the shared save fails', async () => {
      // The store rolls the optimistic config back and toasts on failure; the
      // caller's previously valid `local` pick must survive it — clearing the
      // override for a save that never happened would silently reroute them to
      // the old shared target.
      testState.access.canManageAgent = true;
      testState.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'ws-1' },
      };
      testState.agent.updateAgentConfigById = vi.fn().mockRejectedValue(new Error('save failed'));
      testState.user.workspaceUserPreference = {
        agentDeviceOverrides: {
          'agent-id': { boundDeviceId: 'this-machine', executionTarget: 'local' },
        },
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledTimes(1);
      expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    });

    it('restores the shared config when clearing the override fails after a successful save', async () => {
      // The shared save persisted but the override clear rolled back — the old
      // `local` override would shadow the new shared target (split state), so
      // the hook compensates by writing the previous shared config back.
      testState.access.canManageAgent = true;
      testState.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'ws-1' },
      };
      testState.agent.agencyConfig = { executionTarget: 'device', boundDeviceId: 'ws-device' };
      testState.user.updateWorkspaceUserPreference = vi
        .fn()
        .mockRejectedValue(new Error('clear failed'));
      testState.user.workspaceUserPreference = {
        agentDeviceOverrides: {
          'agent-id': { boundDeviceId: 'this-machine', executionTarget: 'local' },
        },
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.agent.updateAgentConfigById).toHaveBeenNthCalledWith(
        1,
        'agent-id',
        {
          agencyConfig: {
            boundDeviceId: 'ws-device',
            executionTarget: 'sandbox',
          },
        },
        { rethrow: true },
      );
      expect(testState.agent.updateAgentConfigById).toHaveBeenNthCalledWith(
        2,
        'agent-id',
        {
          agencyConfig: { boundDeviceId: 'ws-device', executionTarget: 'device' },
        },
        { showErrorMessage: false },
      );
    });

    it('leaves the preference untouched when a manager picks a shared target with no override', async () => {
      testState.access.canManageAgent = true;
      testState.agent.agentMap = {
        'agent-id': { visibility: 'public', workspaceId: 'ws-1' },
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: { executionTarget: 'sandbox' },
        },
        { rethrow: true },
      );
      expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    });
  });

  describe('private Workspace agent — writes to the owner-controlled shared config', () => {
    it('switches target directly even when the future public policy is fixed', async () => {
      testState.agent.agentMap = {
        'agent-id': { visibility: 'private', workspaceId: 'ws-1' },
      };
      testState.agent.agencyConfig = {
        boundDeviceId: 'owner-device',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      };
      const { result } = renderHook(() => useSelectExecutionTarget('agent-id'));

      await result.current('sandbox');

      expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-id',
        {
          agencyConfig: {
            boundDeviceId: 'owner-device',
            executionTarget: 'sandbox',
            executionTargetSelectionPolicy: 'fixed',
          },
        },
        { rethrow: true },
      );
      expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    });
  });
});
