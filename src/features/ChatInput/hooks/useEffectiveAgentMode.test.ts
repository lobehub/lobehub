import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveEffectiveAgentMode, useEffectiveAgentMode } from './useEffectiveAgentMode';

const testState = vi.hoisted(() => ({
  access: {
    canManageAgent: false,
    isAccessLoading: false,
  },
  agent: {
    agent: undefined as { visibility?: 'private' | 'public'; workspaceId?: string } | undefined,
    enableAgentMode: true,
    model: 'model-1',
    provider: 'provider-1',
  },
  aiInfra: {
    isReady: true,
  },
  supportToolUse: true,
  user: {
    fetchedPreference: undefined as
      { agentModeOverrides?: Record<string, boolean> } | null | undefined,
    isLoading: false,
    useFetchWorkspaceUserPreference: () => ({
      data: testState.user.fetchedPreference,
      isLoading: testState.user.isLoading,
    }),
    workspaceUserPreference: {} as { agentModeOverrides?: Record<string, boolean> },
  },
}));

vi.mock('@/features/ResourcePermission/useAgentManagementAccess', () => ({
  useAgentManagementAccess: () => testState.access,
}));

vi.mock('@/hooks/useModelSupportToolUse', () => ({
  useModelSupportToolUse: () => testState.supportToolUse,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof testState.agent) => unknown) => selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentById: () => (s: typeof testState.agent) => s.agent,
    getAgentEnableModeById: () => (s: typeof testState.agent) => s.enableAgentMode,
    getAgentModelById: () => (s: typeof testState.agent) => s.model,
    getAgentModelProviderById: () => (s: typeof testState.agent) => s.provider,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: (s: typeof testState.aiInfra) => s.isReady,
  },
  useAiInfraStore: (selector: (s: typeof testState.aiInfra) => unknown) =>
    selector(testState.aiInfra),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: typeof testState.user) => unknown) => selector(testState.user),
}));

beforeEach(() => {
  testState.access.canManageAgent = false;
  testState.access.isAccessLoading = false;
  testState.agent.agent = undefined;
  testState.agent.enableAgentMode = true;
  testState.agent.model = 'model-1';
  testState.agent.provider = 'provider-1';
  testState.aiInfra.isReady = true;
  testState.supportToolUse = true;
  testState.user.fetchedPreference = undefined;
  testState.user.isLoading = false;
  testState.user.workspaceUserPreference = {};
});

describe('resolveEffectiveAgentMode', () => {
  it('uses agent mode when the stored mode is enabled and the model supports tool use', () => {
    expect(resolveEffectiveAgentMode({ enableAgentMode: true, supportToolUse: true })).toEqual({
      canSelectAgentMode: true,
      currentMode: 'agent',
      isAgentModeUnavailable: false,
      isAgentRuntimeMode: true,
      supportToolUse: true,
    });
  });

  it('falls back to chat mode without changing the stored mode when the model lacks tool use', () => {
    expect(resolveEffectiveAgentMode({ enableAgentMode: true, supportToolUse: false })).toEqual({
      canSelectAgentMode: false,
      currentMode: 'chat',
      isAgentModeUnavailable: true,
      isAgentRuntimeMode: false,
      supportToolUse: false,
    });
  });

  it('keeps explicit chat mode even when the model supports tool use', () => {
    expect(resolveEffectiveAgentMode({ enableAgentMode: false, supportToolUse: true })).toEqual({
      canSelectAgentMode: true,
      currentMode: 'chat',
      isAgentModeUnavailable: false,
      isAgentRuntimeMode: false,
      supportToolUse: true,
    });
  });

  describe('when the model list is not ready yet', () => {
    it('honours stored agent mode instead of downgrading on the transient unknown', () => {
      // supportToolUse is `false` only because the model has not hydrated yet.
      // We must NOT flash to chat mode / mark agent mode unavailable.
      expect(
        resolveEffectiveAgentMode({
          enableAgentMode: true,
          isModelListReady: false,
          supportToolUse: false,
        }),
      ).toEqual({
        canSelectAgentMode: true,
        currentMode: 'agent',
        isAgentModeUnavailable: false,
        isAgentRuntimeMode: true,
        supportToolUse: true,
      });
    });

    it('still respects an explicit chat-mode choice while not ready', () => {
      expect(
        resolveEffectiveAgentMode({
          enableAgentMode: false,
          isModelListReady: false,
          supportToolUse: false,
        }),
      ).toEqual({
        canSelectAgentMode: true,
        currentMode: 'chat',
        isAgentModeUnavailable: false,
        isAgentRuntimeMode: false,
        supportToolUse: true,
      });
    });

    it('applies the real capability once the list becomes ready', () => {
      expect(
        resolveEffectiveAgentMode({
          enableAgentMode: true,
          isModelListReady: true,
          supportToolUse: false,
        }),
      ).toEqual({
        canSelectAgentMode: false,
        currentMode: 'chat',
        isAgentModeUnavailable: true,
        isAgentRuntimeMode: false,
        supportToolUse: false,
      });
    });
  });
});

describe('useEffectiveAgentMode', () => {
  it('uses an ordinary member personal mode for a public Workspace Agent', () => {
    testState.agent.agent = { visibility: 'public', workspaceId: 'workspace-1' };
    testState.user.workspaceUserPreference = {
      agentModeOverrides: { 'agent-1': false },
    };

    const { result } = renderHook(() => useEffectiveAgentMode('agent-1'));

    expect(result.current).toMatchObject({
      currentMode: 'chat',
      isAgentRuntimeMode: false,
      isPreferenceLoading: false,
      usesWorkspaceMemberMode: true,
    });
  });

  it('ignores a member override for the author or Workspace admin', () => {
    testState.access.canManageAgent = true;
    testState.agent.agent = { visibility: 'public', workspaceId: 'workspace-1' };
    testState.user.workspaceUserPreference = {
      agentModeOverrides: { 'agent-1': false },
    };

    const { result } = renderHook(() => useEffectiveAgentMode('agent-1'));

    expect(result.current).toMatchObject({
      currentMode: 'agent',
      isAgentRuntimeMode: true,
      isPreferenceLoading: false,
      usesWorkspaceMemberMode: false,
    });
  });

  it('waits for the ordinary member preference before exposing the mode control', () => {
    testState.agent.agent = { visibility: 'public', workspaceId: 'workspace-1' };
    testState.user.isLoading = true;

    const { result } = renderHook(() => useEffectiveAgentMode('agent-1'));

    expect(result.current.isPreferenceLoading).toBe(true);
  });
});
