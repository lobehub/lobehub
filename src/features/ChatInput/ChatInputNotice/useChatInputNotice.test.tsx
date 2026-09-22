import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatInputNotice } from './useChatInputNotice';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

interface TestModel {
  abilities?: {
    functionCall?: boolean;
  };
  id: string;
}

interface TestProviderWithModels {
  children: TestModel[];
  id: string;
}

interface TestBuiltinModel {
  id: string;
  providerId: string;
  type: 'chat';
}

const testState = vi.hoisted(() => ({
  agent: {
    agencyConfig: undefined as
      { executionTarget?: string; heterogeneousProvider?: { type: string } } | undefined,
    isConfigLoading: false,
    model: 'gpt-4o',
    provider: 'openai',
  },
  /** Effective (override-resolved) selection, as `useAgentModelSelection` returns it. */
  agentModelSelection: {
    canSelectModel: true,
    isPreferenceLoading: false,
    model: undefined as string | undefined,
    provider: undefined as string | undefined,
    selectModel: vi.fn(async () => {}),
    selectionPolicy: 'fixed' as 'fixed' | 'member',
  },
  aiInfra: {
    builtinAiModelList: [] as TestBuiltinModel[],
    enabledChatModelList: [] as TestProviderWithModels[],
    enabledAiProviders: [] as { id: string }[],
    isInitAiProviderRuntimeState: false,
    modelRedirects: {} as Record<string, string>,
    toggleProviderEnabled: vi.fn(async () => {}),
    toggleProviderModelEnabled: vi.fn(async () => {}),
  },
  isDesktop: false,
  permission: {
    canManageAiInfra: true,
    reason: undefined as string | undefined,
  },
  resourceAccess: {
    canConfigureResource: true,
    isAccessLoading: false,
    isAccessResolved: true,
    canUseResource: true,
    isGroupContext: false,
    isResourceGated: false,
  },
}));

type StoreSelector<T = unknown, S = Record<PropertyKey, unknown>> = (state: S) => T;

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return testState.isDesktop;
  },
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: toastError },
}));

vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({
  useAgentId: () => 'agent-id',
}));

vi.mock('@/features/ChatInput/hooks/useAgentModelSelection', () => ({
  useAgentModelSelection: () => ({
    canSelectModel: testState.agentModelSelection.canSelectModel,
    isPreferenceLoading: testState.agentModelSelection.isPreferenceLoading,
    // Default to the shared agent config, matching `resolveAgentModelConfig`
    // when there is no member override.
    model: testState.agentModelSelection.model ?? testState.agent.model,
    provider: testState.agentModelSelection.provider ?? testState.agent.provider,
    selectModel: testState.agentModelSelection.selectModel,
    selectionPolicy: testState.agentModelSelection.selectionPolicy,
  }),
}));

vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => testState.resourceAccess,
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => testState.aiInfra.enabledChatModelList,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    allowed: testState.permission.canManageAiInfra,
    reason: testState.permission.reason,
  }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: <T,>(selector: StoreSelector<T, typeof testState.agent>) =>
    selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    isAgentConfigLoadingById: () => (s: typeof testState.agent) => s.isConfigLoading,
    isAgentHeterogeneousById: () => (s: typeof testState.agent) =>
      Boolean(s.agencyConfig?.heterogeneousProvider),
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: (s: typeof testState.aiInfra) => s.isInitAiProviderRuntimeState,
  },
  useAiInfraStore: <T,>(selector: StoreSelector<T, typeof testState.aiInfra>) =>
    selector(testState.aiInfra),
}));

describe('useChatInputNotice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    testState.agent.agencyConfig = undefined;
    testState.agent.isConfigLoading = false;
    testState.agentModelSelection = {
      canSelectModel: true,
      isPreferenceLoading: false,
      model: undefined,
      provider: undefined,
      selectModel: vi.fn(async () => {}),
      selectionPolicy: 'fixed',
    };
    testState.agent.model = 'gpt-4o';
    testState.agent.provider = 'openai';
    testState.aiInfra.builtinAiModelList = [];
    testState.aiInfra.enabledChatModelList = [];
    testState.aiInfra.enabledAiProviders = [];
    testState.aiInfra.isInitAiProviderRuntimeState = false;
    testState.aiInfra.modelRedirects = {};
    testState.aiInfra.toggleProviderEnabled.mockReset();
    testState.aiInfra.toggleProviderModelEnabled.mockReset();
    toastError.mockReset();
    testState.isDesktop = false;
    testState.permission.canManageAiInfra = true;
    testState.permission.reason = undefined;
    testState.resourceAccess = {
      canConfigureResource: true,
      isAccessLoading: false,
      isAccessResolved: true,
      canUseResource: true,
      isGroupContext: false,
      isResourceGated: false,
    };
  });

  it('returns the agent view-only notice when the member lacks use access', () => {
    testState.resourceAccess = {
      canConfigureResource: false,
      isAccessLoading: false,
      isAccessResolved: true,
      canUseResource: false,
      isGroupContext: false,
      isResourceGated: true,
    };

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.viewOnlyAgent', type: 'warning' });
  });

  it('returns the group view-only notice in group context and outranks model notices', () => {
    testState.resourceAccess = {
      canConfigureResource: false,
      isAccessLoading: false,
      isAccessResolved: true,
      canUseResource: false,
      isGroupContext: true,
      isResourceGated: true,
    };
    // Would produce input.modelUnavailable on its own — view-only must win.
    testState.aiInfra.isInitAiProviderRuntimeState = true;

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.viewOnlyGroup', type: 'warning' });
  });

  it('stays silent for a gated member who can use but not edit the agent', () => {
    // The use-only permission is explained on the controls it actually locks
    // (model trigger / device chip), not as a standing banner.
    testState.resourceAccess = {
      canConfigureResource: false,
      isAccessLoading: false,
      isAccessResolved: true,
      canUseResource: true,
      isGroupContext: false,
      isResourceGated: true,
    };
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('stays silent for a gated member in group context', () => {
    testState.resourceAccess = {
      canConfigureResource: false,
      isAccessLoading: false,
      isAccessResolved: true,
      canUseResource: true,
      isGroupContext: true,
      isResourceGated: true,
    };
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('still warns about an unavailable model for a use-only member', () => {
    testState.resourceAccess = {
      canConfigureResource: false,
      isAccessLoading: false,
      isAccessResolved: true,
      canUseResource: true,
      isGroupContext: false,
      isResourceGated: true,
    };
    // selected model absent from the chat selector → modelUnavailable wins
    testState.aiInfra.isInitAiProviderRuntimeState = true;

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.modelUnavailable', type: 'warning' });
  });

  it('does not return a notice before the model runtime config is ready', () => {
    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('returns unavailable model copy when the ready model config no longer contains the selected model', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.modelUnavailable', type: 'warning' });
  });

  it('offers to enable a model that still exists but is disabled', async () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.builtinAiModelList = [{ id: 'gpt-4o', providerId: 'openai', type: 'chat' }];
    testState.aiInfra.enabledChatModelList = [{ children: [{ id: 'gpt-4.1' }], id: 'openai' }];
    testState.aiInfra.enabledAiProviders = [{ id: 'openai' }];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toMatchObject({
      action: 'enableModel',
      actionLoading: false,
      key: 'input.modelDisabled',
      type: 'warning',
    });

    await act(async () => result.current?.onAction?.());

    expect(testState.aiInfra.toggleProviderEnabled).not.toHaveBeenCalled();
    expect(testState.aiInfra.toggleProviderModelEnabled).toHaveBeenCalledWith({
      enabled: true,
      id: 'gpt-4o',
      providerId: 'openai',
      type: 'chat',
    });
  });

  it('disables Enable with the permission reason when the member cannot manage AI infrastructure', () => {
    testState.permission.canManageAiInfra = false;
    testState.permission.reason = 'Requires admin permission';
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.builtinAiModelList = [{ id: 'gpt-4o', providerId: 'openai', type: 'chat' }];
    testState.aiInfra.enabledChatModelList = [{ children: [{ id: 'gpt-4.1' }], id: 'openai' }];
    testState.aiInfra.enabledAiProviders = [{ id: 'openai' }];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({
      action: 'enableModel',
      actionDisabled: true,
      actionDisabledReason: 'Requires admin permission',
      actionLoading: false,
      key: 'input.modelDisabled',
      onAction: undefined,
      type: 'warning',
    });
  });

  it('enables the owning provider before enabling its disabled model', async () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.builtinAiModelList = [{ id: 'gpt-4o', providerId: 'openai', type: 'chat' }];

    const { result } = renderHook(() => useChatInputNotice());

    await act(async () => result.current?.onAction?.());

    expect(testState.aiInfra.toggleProviderEnabled).toHaveBeenCalledWith('openai', true);
    expect(testState.aiInfra.toggleProviderModelEnabled).toHaveBeenCalledWith({
      enabled: true,
      id: 'gpt-4o',
      providerId: 'openai',
      type: 'chat',
    });
  });

  it('treats a disabled model as unavailable when a locked selection would require a provider fallback', () => {
    testState.agent.provider = 'removed-provider';
    testState.agentModelSelection.canSelectModel = false;
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.builtinAiModelList = [{ id: 'gpt-4o', providerId: 'openai', type: 'chat' }];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.modelUnavailable', type: 'warning' });
  });

  it('enables and selects a fallback provider when the selection is editable', async () => {
    testState.agent.provider = 'removed-provider';
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.builtinAiModelList = [{ id: 'gpt-4o', providerId: 'openai', type: 'chat' }];

    const { result } = renderHook(() => useChatInputNotice());

    await act(async () => result.current?.onAction?.());

    expect(testState.aiInfra.toggleProviderEnabled).toHaveBeenCalledWith('openai', true);
    expect(testState.aiInfra.toggleProviderModelEnabled).toHaveBeenCalledWith({
      enabled: true,
      id: 'gpt-4o',
      providerId: 'openai',
      type: 'chat',
    });
    expect(testState.agentModelSelection.selectModel).toHaveBeenCalledWith({
      model: 'gpt-4o',
      provider: 'openai',
    });
  });

  it('reports a provider selection failure separately after enabling the fallback model', async () => {
    const selectionError = new Error('selection failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    testState.agent.provider = 'removed-provider';
    testState.agentModelSelection.selectModel = vi.fn(async () => {
      throw selectionError;
    });
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.builtinAiModelList = [{ id: 'gpt-4o', providerId: 'openai', type: 'chat' }];

    const { result } = renderHook(() => useChatInputNotice());

    await act(async () => result.current?.onAction?.());

    expect(testState.aiInfra.toggleProviderModelEnabled).toHaveBeenCalledWith({
      enabled: true,
      id: 'gpt-4o',
      providerId: 'openai',
      type: 'chat',
    });
    expect(toastError).toHaveBeenCalledWith(
      expect.stringMatching(/selectionFailed|switching providers failed/),
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to select the enabled chat model provider:',
      selectionError,
    );
  });

  it('does not return unavailable model copy while the agent config is still loading', () => {
    // Cold page load: runtime config is ready but `agentMap` has no entry yet,
    // so the model selectors still report the DEFAULT_MODEL fallback.
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.agent.isConfigLoading = true;
    testState.agent.model = 'default-model';
    testState.agent.provider = 'default-provider';
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('judges the member override rather than the shared model on a workspace agent', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    // Shared model is retired, but this member overrode it with a live one —
    // the trigger shows the override, so the notice must judge the override.
    testState.agent.model = 'gpt-4-32k';
    testState.agentModelSelection.selectionPolicy = 'member';
    testState.agentModelSelection.model = 'gpt-4o';
    testState.agentModelSelection.provider = 'openai';
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('does not return unavailable model copy while a member-policy preference is still loading', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.agentModelSelection.selectionPolicy = 'member';
    testState.agentModelSelection.isPreferenceLoading = true;
    testState.agent.model = 'gpt-4-32k';

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('still warns on a fixed-policy workspace agent while the preference request is in flight', () => {
    // `fixed` ignores the member override, so the effective model is already
    // settled — the unrelated preferences fetch must not swallow the warning.
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.agentModelSelection.selectionPolicy = 'fixed';
    testState.agentModelSelection.isPreferenceLoading = true;
    testState.agent.model = 'gpt-4-32k';

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.modelUnavailable', type: 'warning' });
  });

  it('does not return unsupported tool-use copy when the selected model exists but lacks tool calls', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: false }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('returns unavailable model copy when the selected model is enabled globally but absent from the chat selector list', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-image-1' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.modelUnavailable', type: 'warning' });
  });

  it('does not return a notice when the ready model supports tool use', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('does not return a model notice for heterogeneous agents', () => {
    testState.agent.agencyConfig = { heterogeneousProvider: { type: 'codex' } };
    testState.aiInfra.isInitAiProviderRuntimeState = true;

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('does not show an input notice when the cloud sandbox is selected', () => {
    testState.isDesktop = true;
    testState.agent.agencyConfig = { executionTarget: 'sandbox' };
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('does not return the sandbox tip off desktop even when the sandbox is selected', () => {
    testState.isDesktop = false;
    testState.agent.agencyConfig = { executionTarget: 'sandbox' };
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('does not show an input notice for heterogeneous agents that selected the sandbox', () => {
    testState.isDesktop = true;
    testState.agent.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'codex' },
    };
    testState.aiInfra.isInitAiProviderRuntimeState = true;

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toBeUndefined();
  });

  it('returns the model warning when a sandbox target also has an unavailable model', () => {
    testState.isDesktop = true;
    testState.agent.agencyConfig = { executionTarget: 'sandbox' };
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    // selected model absent from the chat selector → modelUnavailable

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.modelUnavailable', type: 'warning' });
  });
});
