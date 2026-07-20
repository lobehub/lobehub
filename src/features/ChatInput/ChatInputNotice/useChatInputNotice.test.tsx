import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatInputNotice } from './useChatInputNotice';

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

const testState = vi.hoisted(() => ({
  agent: {
    agencyConfig: undefined as
      { executionTarget?: string; heterogeneousProvider?: { type: string } } | undefined,
    model: 'gpt-4o',
    provider: 'openai',
  },
  aiInfra: {
    enabledChatModelList: [] as TestProviderWithModels[],
    isInitAiProviderRuntimeState: false,
  },
  isDesktop: false,
  resourceAccess: { canUseResource: true, isGroupContext: false },
}));

type StoreSelector<T = unknown, S = Record<PropertyKey, unknown>> = (state: S) => T;

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return testState.isDesktop;
  },
}));

vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({
  useAgentId: () => 'agent-id',
}));

vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => testState.resourceAccess,
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => testState.aiInfra.enabledChatModelList,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: <T,>(selector: StoreSelector<T, typeof testState.agent>) =>
    selector(testState.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => (s: typeof testState.agent) => s.agencyConfig,
    getAgentModelById: () => (s: typeof testState.agent) => s.model,
    getAgentModelProviderById: () => (s: typeof testState.agent) => s.provider,
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
  beforeEach(() => {
    testState.agent.agencyConfig = undefined;
    testState.agent.model = 'gpt-4o';
    testState.agent.provider = 'openai';
    testState.aiInfra.enabledChatModelList = [];
    testState.aiInfra.isInitAiProviderRuntimeState = false;
    testState.isDesktop = false;
    testState.resourceAccess = { canUseResource: true, isGroupContext: false };
  });

  it('returns the agent view-only notice when the member lacks use access', () => {
    testState.resourceAccess = { canUseResource: false, isGroupContext: false };

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.viewOnlyAgent', type: 'warning' });
  });

  it('returns the group view-only notice in group context and outranks model notices', () => {
    testState.resourceAccess = { canUseResource: false, isGroupContext: true };
    // Would produce input.modelUnavailable on its own — view-only must win.
    testState.aiInfra.isInitAiProviderRuntimeState = true;

    const { result } = renderHook(() => useChatInputNotice());

    expect(result.current).toEqual({ key: 'input.viewOnlyGroup', type: 'warning' });
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
