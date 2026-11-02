import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveEffectiveAgentMode,
  resolveModeFlags,
  useEffectiveAgentMode,
} from './useEffectiveAgentMode';

const testState = vi.hoisted(() => ({
  access: {
    canManageAgent: false,
    isAccessLoading: false,
  },
  agent: {
    agent: undefined as { visibility?: 'private' | 'public'; workspaceId?: string } | undefined,
    contextMode: 'default' as 'default' | 'on-demand',
    enableAgentMode: true,
    model: 'model-1',
    promptMode: 'full' as 'full' | 'lean',
    provider: 'provider-1',
    toolMode: undefined as 'agent' | 'chat' | 'custom' | undefined,
  },
  aiInfra: {
    isReady: true,
  },
  supportToolUse: true,
  user: {
    fetchedPreference: undefined as
      | {
          agentContextModeOverrides?: Record<string, 'default' | 'on-demand'>;
          agentModeOverrides?: Record<string, boolean>;
        }
      | null
      | undefined,
    isLoading: false,
    useFetchWorkspaceUserPreference: () => ({
      data: testState.user.fetchedPreference,
      isLoading: testState.user.isLoading,
    }),
    workspaceUserPreference: {} as {
      agentContextModeOverrides?: Record<string, 'default' | 'on-demand'>;
      agentModeOverrides?: Record<string, boolean>;
    },
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
    getAgentPromptModeById: () => (s: typeof testState.agent) => s.promptMode,
  },
  chatConfigByIdSelectors: {
    getChatConfigById: () => (s: typeof testState.agent) => ({ toolMode: s.toolMode }),
    getContextModeById: () => (s: typeof testState.agent) => s.contextMode,
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
  testState.agent.contextMode = 'default';
  testState.agent.enableAgentMode = true;
  testState.agent.model = 'model-1';
  testState.agent.provider = 'provider-1';
  testState.agent.toolMode = undefined;
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
      canSelectOnDemandMode: true,
      currentMode: 'agent',
      isAgentModeUnavailable: false,
      isAgentRuntimeMode: true,
      supportToolUse: true,
    });
  });

  it('falls back to chat mode without changing the stored mode when the model lacks tool use', () => {
    expect(resolveEffectiveAgentMode({ enableAgentMode: true, supportToolUse: false })).toEqual({
      canSelectAgentMode: false,
      canSelectOnDemandMode: false,
      currentMode: 'chat',
      isAgentModeUnavailable: true,
      isAgentRuntimeMode: false,
      supportToolUse: false,
    });
  });

  it('keeps explicit chat mode even when the model supports tool use', () => {
    expect(resolveEffectiveAgentMode({ enableAgentMode: false, supportToolUse: true })).toEqual({
      canSelectAgentMode: true,
      canSelectOnDemandMode: true,
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
        canSelectOnDemandMode: true,
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
        canSelectOnDemandMode: true,
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
        canSelectOnDemandMode: false,
        currentMode: 'chat',
        isAgentModeUnavailable: true,
        isAgentRuntimeMode: false,
        supportToolUse: false,
      });
    });
  });

  it('enters on-demand only when explicitly stored, agent-effective, and FC-capable', () => {
    expect(
      resolveEffectiveAgentMode({
        contextMode: 'on-demand',
        enableAgentMode: true,
        supportToolUse: true,
      }),
    ).toEqual({
      canSelectAgentMode: true,
      canSelectOnDemandMode: true,
      currentMode: 'on-demand',
      isAgentModeUnavailable: false,
      isAgentRuntimeMode: true,
      supportToolUse: true,
    });
  });

  it('does not offer on-demand when the explicit tool mode is custom', () => {
    expect(
      resolveEffectiveAgentMode({
        contextMode: 'on-demand',
        enableAgentMode: true,
        supportToolUse: true,
        toolMode: 'custom',
      }),
    ).toEqual({
      canSelectAgentMode: true,
      canSelectOnDemandMode: false,
      currentMode: 'agent',
      isAgentModeUnavailable: false,
      isAgentRuntimeMode: true,
      supportToolUse: true,
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

  it('restores the explicitly stored on-demand mode after the preference loads', () => {
    testState.agent.contextMode = 'on-demand';

    const { result } = renderHook(() => useEffectiveAgentMode('agent-1'));

    expect(result.current).toMatchObject({
      canSelectOnDemandMode: true,
      currentMode: 'on-demand',
      isAgentRuntimeMode: true,
    });
  });

  it('restores a Workspace member on-demand preference independently of the shared Agent', () => {
    testState.agent.agent = { visibility: 'public', workspaceId: 'workspace-1' };
    testState.agent.contextMode = 'default';
    testState.user.workspaceUserPreference = {
      agentContextModeOverrides: { 'agent-1': 'on-demand' },
      agentModeOverrides: { 'agent-1': true },
    };

    const { result } = renderHook(() => useEffectiveAgentMode('agent-1'));

    expect(result.current).toMatchObject({
      currentMode: 'on-demand',
      usesWorkspaceMemberMode: true,
    });
  });

  it('lets a Workspace member enable on-demand over a shared chat-mode Agent', () => {
    testState.agent.agent = { visibility: 'public', workspaceId: 'workspace-1' };
    testState.agent.contextMode = 'default';
    testState.agent.enableAgentMode = false;
    testState.agent.toolMode = undefined;
    testState.user.workspaceUserPreference = {
      agentContextModeOverrides: { 'agent-1': 'on-demand' },
      agentModeOverrides: { 'agent-1': true },
    };

    const { result } = renderHook(() => useEffectiveAgentMode('agent-1'));

    expect(result.current).toMatchObject({
      currentMode: 'on-demand',
      isAgentRuntimeMode: true,
    });
  });
});

describe('resolveModeFlags', () => {
  it.each([
    ['agent', { contextMode: 'default', enableAgentMode: true, promptMode: 'full' }],
    ['chat', { contextMode: 'default', enableAgentMode: false, promptMode: 'full' }],
    ['on-demand', { contextMode: 'on-demand', enableAgentMode: true, promptMode: 'full' }],
  ] as const)('maps %s to its persisted flags', (mode, expected) => {
    expect(resolveModeFlags(mode)).toEqual(expected);
  });
});
