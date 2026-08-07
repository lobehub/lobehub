import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentPermission } from './useAgentPermission';

const mocks = vi.hoisted(() => ({
  access: undefined as { accessLevel: string; canManage: boolean } | undefined,
  accessError: undefined as unknown,
  agentMap: {} as Record<string, object>,
  canEditContent: true,
  devices: [] as unknown[],
  permissionResourceId: undefined as string | undefined,
  setAccessLevel: vi.fn(),
  updateAgentConfigById: vi.fn(),
}));

vi.mock('@/features/DeviceManager/useDeviceList', () => ({
  useDeviceList: () => ({ data: mocks.devices }),
}));

vi.mock('@/features/ResourcePermission/useResourcePermission', () => ({
  useResourcePermission: (_type: string, resourceId: string | undefined) => {
    mocks.permissionResourceId = resourceId;

    return {
      data: mocks.access,
      error: mocks.accessError,
      isLoading: false,
      mutate: vi.fn(),
      setAccessLevel: mocks.setAccessLevel,
      updating: false,
    };
  },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEditContent }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({
      agentMap: mocks.agentMap,
      updateAgentConfigById: mocks.updateAgentConfigById,
    }),
}));

const workspaceAgent = (overrides: Record<string, unknown> = {}) => ({
  agencyConfig: {},
  visibility: 'public',
  workspaceId: 'workspace-1',
  ...overrides,
});

const publicDevice = {
  deviceId: 'workspace-device',
  online: true,
  scope: 'workspace',
  visibility: 'public',
};

const setup = (agentId = 'agent-1') => renderHook(() => useAgentPermission(agentId));

describe('useAgentPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access = { accessLevel: 'use', canManage: true };
    mocks.accessError = undefined;
    mocks.canEditContent = true;
    mocks.devices = [];
    mocks.permissionResourceId = undefined;
    mocks.agentMap = { 'agent-1': workspaceAgent() };
  });

  it('exposes member access for a shared workspace agent', () => {
    const { result } = setup();

    expect(result.current.isWorkspaceAgent).toBe(true);
    expect(mocks.permissionResourceId).toBe('agent-1');
    expect(result.current.accessLevel).toBe('use');
    expect(result.current.canManageAccess).toBe(true);
  });

  it('keeps the member level readable and settable on a private agent', () => {
    // The server stores it and the publish paths read it back, so this is the
    // same configure-ahead-of-sharing promise the switch policies make.
    mocks.agentMap = { 'agent-1': workspaceAgent({ visibility: 'private' }) };

    const { result } = setup();

    expect(result.current.isPrivate).toBe(true);
    expect(mocks.permissionResourceId).toBe('agent-1');
    expect(result.current.accessLevel).toBe('use');
    expect(result.current.canManageAccess).toBe(true);
  });

  it('reports a personal agent as out of scope for permissions', () => {
    mocks.agentMap = { 'agent-1': { agencyConfig: {}, visibility: 'private' } };

    const { result } = setup();

    expect(result.current.isWorkspaceAgent).toBe(false);
  });

  it('defaults both policies to member-switchable when nothing is stored', () => {
    const { result } = setup();

    expect(result.current.modelPolicy).toBe('member');
    expect(result.current.executionTargetPolicy).toBe('member');
  });

  it('reads the stored intent on a private agent instead of the run-time resolution', () => {
    // `resolveAgentModelSelectionPolicy` would answer `fixed` here (a private
    // agent has no members), which would strand the control on "can't switch".
    mocks.agentMap = {
      'agent-1': workspaceAgent({
        agencyConfig: { modelSelectionPolicy: 'member' },
        visibility: 'private',
      }),
    };

    const { result } = setup();

    expect(result.current.modelPolicy).toBe('member');
  });

  it('saves the model policy through the agent config', () => {
    const { result } = setup();

    result.current.setModelPolicy('fixed');

    expect(mocks.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      agencyConfig: { modelSelectionPolicy: 'fixed' },
    });
  });

  it('pins the currently selected environment when the policy is fixed', () => {
    mocks.devices = [publicDevice];
    mocks.agentMap = {
      'agent-1': workspaceAgent({
        agencyConfig: {
          boundDeviceId: 'workspace-device',
          executionTarget: 'device',
          heterogeneousProvider: { type: 'claude-code' },
        },
      }),
    };

    const { result } = setup();

    expect(result.current.canFixExecutionTarget).toBe(true);
    result.current.setExecutionTargetPolicy('fixed');

    expect(mocks.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      agencyConfig: {
        boundDeviceId: 'workspace-device',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      },
    });
  });

  it('refuses to fix an environment that has not been picked yet', () => {
    mocks.agentMap = {
      'agent-1': workspaceAgent({
        agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
      }),
    };

    const { result } = setup();

    expect(result.current.canFixExecutionTarget).toBe(false);

    result.current.setExecutionTargetPolicy('fixed');

    expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('reopens member selection without touching the stored target', () => {
    mocks.agentMap = {
      'agent-1': workspaceAgent({
        agencyConfig: { executionTarget: 'sandbox', executionTargetSelectionPolicy: 'fixed' },
      }),
    };

    const { result } = setup();

    result.current.setExecutionTargetPolicy('member');

    expect(mocks.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      agencyConfig: { executionTargetSelectionPolicy: 'member' },
    });
  });

  it('withholds member re-leveling from someone who cannot manage the agent', () => {
    mocks.access = { accessLevel: 'use', canManage: false };

    const { result } = setup();

    expect(result.current.canManageAccess).toBe(false);
  });

  it('withholds the config policies from a role that cannot edit content', () => {
    mocks.canEditContent = false;

    const { result } = setup();

    expect(result.current.canEditConfig).toBe(false);
  });
});
