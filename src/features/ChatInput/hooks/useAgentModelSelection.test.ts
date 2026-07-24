import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentModelSelection } from './useAgentModelSelection';

const testState = vi.hoisted(() => ({
  access: {
    canManageAgent: true,
    isAccessLoading: false,
  },
  permission: {
    allowed: true,
  },
  resource: {
    canConfigureResource: true,
    canUseResource: true,
    isAccessLoading: false,
  },
  agent: {
    agencyConfig: undefined as { modelSelectionPolicy?: 'fixed' | 'member' } | undefined,
    agentMap: {
      'agent-1': {} as { visibility?: 'private' | 'public'; workspaceId?: string },
    },
    model: 'shared-model',
    provider: 'shared-provider',
    updateAgentConfigById: vi.fn(),
  },
  user: {
    fetchedPreference: undefined as
      | {
          agentModelOverrides?: Record<string, { model: string; provider: string }>;
        }
      | null
      | undefined,
    isLoading: false,
    updateWorkspaceUserPreference: vi.fn(),
    useFetchWorkspaceUserPreference: () => ({
      data: testState.user.fetchedPreference,
      isLoading: testState.user.isLoading,
    }),
    workspaceUserPreference: {} as {
      agentModelOverrides?: Record<string, { model: string; provider: string }>;
    },
  },
}));

vi.mock('@/business/client/hooks/useBusinessAgentMode', () => ({
  useBusinessModelModeConfig: () => (config: unknown) => config,
}));

vi.mock('@/features/ResourcePermission/useAgentManagementAccess', () => ({
  useAgentManagementAccess: () => testState.access,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => testState.permission,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof testState.agent) => unknown) => selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => (s: typeof testState.agent) => s.agencyConfig,
    getAgentById: () => (s: typeof testState.agent) => s.agentMap['agent-1'],
    getAgentModelById: () => (s: typeof testState.agent) => s.model,
    getAgentModelProviderById: () => (s: typeof testState.agent) => s.provider,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: typeof testState.user) => unknown) => selector(testState.user),
}));

vi.mock('./useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => testState.resource,
}));

describe('useAgentModelSelection', () => {
  beforeEach(() => {
    testState.access.canManageAgent = true;
    testState.access.isAccessLoading = false;
    testState.permission.allowed = true;
    testState.resource.canConfigureResource = true;
    testState.resource.canUseResource = true;
    testState.resource.isAccessLoading = false;
    testState.agent.agencyConfig = undefined;
    testState.agent.agentMap['agent-1'] = {};
    testState.agent.model = 'shared-model';
    testState.agent.provider = 'shared-provider';
    testState.agent.updateAgentConfigById = vi.fn();
    testState.user.fetchedPreference = undefined;
    testState.user.isLoading = false;
    testState.user.updateWorkspaceUserPreference = vi.fn();
    testState.user.workspaceUserPreference = {};
  });

  it('keeps the legacy shared-config write for a personal Agent', async () => {
    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    await result.current.selectModel({ model: 'next-model', provider: 'next-provider' });

    expect(result.current).toMatchObject({
      canDisplayModel: true,
      canSelectModel: true,
      model: 'shared-model',
      provider: 'shared-provider',
      usesWorkspaceMemberSelection: false,
    });
    expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      model: 'next-model',
      provider: 'next-provider',
    });
    expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });

  it('defaults a legacy public Workspace Agent to member selection', async () => {
    testState.access.canManageAgent = false;
    testState.resource.canConfigureResource = false;
    testState.agent.agentMap['agent-1'] = {
      visibility: 'public',
      workspaceId: 'workspace-1',
    };
    testState.user.workspaceUserPreference = {
      agentModelOverrides: {
        'agent-1': { model: 'member-model', provider: 'member-provider' },
      },
    };
    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    await result.current.selectModel({ model: 'next-model', provider: 'next-provider' });

    expect(result.current).toMatchObject({
      canDisplayModel: true,
      canSelectModel: true,
      model: 'member-model',
      provider: 'member-provider',
      selectionPolicy: 'member',
      usesWorkspaceMemberSelection: true,
    });
    expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
      agentModelOverrides: {
        'agent-1': { model: 'next-model', provider: 'next-provider' },
      },
    });
    expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('keeps an explicit fixed policy locked for a public Workspace Agent', async () => {
    testState.access.canManageAgent = false;
    testState.resource.canConfigureResource = false;
    testState.agent.agencyConfig = { modelSelectionPolicy: 'fixed' };
    testState.agent.agentMap['agent-1'] = {
      visibility: 'public',
      workspaceId: 'workspace-1',
    };
    testState.user.workspaceUserPreference = {
      agentModelOverrides: {
        'agent-1': { model: 'member-model', provider: 'member-provider' },
      },
    };
    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    await result.current.selectModel({ model: 'next-model', provider: 'next-provider' });

    expect(result.current).toMatchObject({
      canDisplayModel: true,
      canSelectModel: false,
      model: 'shared-model',
      provider: 'shared-provider',
      selectionPolicy: 'fixed',
    });
    expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('shows and updates the caller override when member selection is enabled', async () => {
    testState.access.canManageAgent = false;
    testState.resource.canConfigureResource = false;
    testState.agent.agencyConfig = { modelSelectionPolicy: 'member' };
    testState.agent.agentMap['agent-1'] = {
      visibility: 'public',
      workspaceId: 'workspace-1',
    };
    testState.user.fetchedPreference = {
      agentModelOverrides: {
        'agent-1': { model: 'member-model', provider: 'member-provider' },
        'other': { model: 'other-model', provider: 'other-provider' },
      },
    };
    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    await result.current.selectModel({ model: 'next-model', provider: 'next-provider' });

    expect(result.current).toMatchObject({
      canDisplayModel: true,
      canSelectModel: true,
      model: 'member-model',
      provider: 'member-provider',
      selectionPolicy: 'member',
    });
    expect(testState.user.updateWorkspaceUserPreference).toHaveBeenCalledWith({
      agentModelOverrides: {
        'agent-1': { model: 'next-model', provider: 'next-provider' },
        'other': { model: 'other-model', provider: 'other-provider' },
      },
    });
    expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('does not overwrite preferences before the workspace bucket settles', async () => {
    testState.access.canManageAgent = false;
    testState.resource.canConfigureResource = false;
    testState.agent.agencyConfig = { modelSelectionPolicy: 'member' };
    testState.agent.agentMap['agent-1'] = {
      visibility: 'public',
      workspaceId: 'workspace-1',
    };
    testState.user.isLoading = true;
    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    await result.current.selectModel({ model: 'next-model', provider: 'next-provider' });

    expect(result.current.isPreferenceLoading).toBe(true);
    expect(result.current.canDisplayModel).toBe(false);
    expect(result.current.canSelectModel).toBe(false);
    expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });

  it('updates the shared config for a private workspace Agent regardless of member policy', async () => {
    testState.agent.agentMap['agent-1'] = {
      visibility: 'private',
      workspaceId: 'workspace-1',
    };
    testState.user.isLoading = true;
    testState.user.workspaceUserPreference = {
      agentModelOverrides: {
        'agent-1': { model: 'member-model', provider: 'member-provider' },
      },
    };
    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    await result.current.selectModel({ model: 'next-model', provider: 'next-provider' });

    expect(result.current).toMatchObject({
      canDisplayModel: true,
      canSelectModel: true,
      isPreferenceLoading: false,
      model: 'shared-model',
      provider: 'shared-provider',
      selectionPolicy: 'fixed',
      usesWorkspaceMemberSelection: false,
    });
    expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      model: 'next-model',
      provider: 'next-provider',
    });
    expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });

  it('lets the author or Workspace admin update the shared model regardless of member policy', async () => {
    testState.agent.agencyConfig = { modelSelectionPolicy: 'fixed' };
    testState.agent.agentMap['agent-1'] = {
      visibility: 'public',
      workspaceId: 'workspace-1',
    };
    testState.user.workspaceUserPreference = {
      agentModelOverrides: {
        'agent-1': { model: 'stale-member-model', provider: 'stale-member-provider' },
      },
    };
    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    await result.current.selectModel({ model: 'next-model', provider: 'next-provider' });

    expect(result.current).toMatchObject({
      canDisplayModel: true,
      canSelectModel: true,
      model: 'shared-model',
      provider: 'shared-provider',
      selectionPolicy: 'fixed',
      usesWorkspaceMemberSelection: false,
    });
    expect(testState.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-1', {
      model: 'next-model',
      provider: 'next-provider',
    });
    expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
  });

  it('hides the model summary when the caller cannot use the Agent', () => {
    testState.resource.canConfigureResource = false;
    testState.resource.canUseResource = false;

    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    expect(result.current).toMatchObject({
      canDisplayModel: false,
      canSelectModel: false,
    });
  });
});
