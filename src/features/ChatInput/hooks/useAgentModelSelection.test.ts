import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentModelSelection } from './useAgentModelSelection';

const testState = vi.hoisted(() => ({
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

describe('useAgentModelSelection', () => {
  beforeEach(() => {
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

  it('defaults a workspace Agent to fixed and ignores a retained personal choice', async () => {
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
      model: 'shared-model',
      provider: 'shared-provider',
      selectionPolicy: 'fixed',
      usesWorkspaceMemberSelection: true,
    });
    expect(testState.user.updateWorkspaceUserPreference).not.toHaveBeenCalled();
    expect(testState.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('shows and updates the caller override when member selection is enabled', async () => {
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
    testState.agent.agencyConfig = { modelSelectionPolicy: 'member' };
    testState.agent.agentMap['agent-1'] = {
      visibility: 'public',
      workspaceId: 'workspace-1',
    };
    testState.user.isLoading = true;
    const { result } = renderHook(() => useAgentModelSelection('agent-1'));

    await result.current.selectModel({ model: 'next-model', provider: 'next-provider' });

    expect(result.current.isPreferenceLoading).toBe(true);
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
});
