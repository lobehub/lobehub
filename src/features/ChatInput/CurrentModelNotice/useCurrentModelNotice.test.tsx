import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCurrentModelNotice } from './useCurrentModelNotice';

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
    agencyConfig: undefined as { heterogeneousProvider?: { type: string } } | undefined,
    model: 'gpt-4o',
    provider: 'openai',
  },
  aiInfra: {
    enabledChatModelList: [] as TestProviderWithModels[],
    isInitAiProviderRuntimeState: false,
  },
}));

type StoreSelector<T = unknown, S = Record<PropertyKey, unknown>> = (state: S) => T;

vi.mock('@/features/ChatInput/hooks/useAgentId', () => ({
  useAgentId: () => 'agent-id',
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

describe('useCurrentModelNotice', () => {
  beforeEach(() => {
    testState.agent.agencyConfig = undefined;
    testState.agent.model = 'gpt-4o';
    testState.agent.provider = 'openai';
    testState.aiInfra.enabledChatModelList = [];
    testState.aiInfra.isInitAiProviderRuntimeState = false;
  });

  it('does not return a notice before the model runtime config is ready', () => {
    const { result } = renderHook(() => useCurrentModelNotice());

    expect(result.current).toBeUndefined();
  });

  it('returns unavailable model copy when the ready model config no longer contains the selected model', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;

    const { result } = renderHook(() => useCurrentModelNotice());

    expect(result.current).toBe('input.modelUnavailable');
  });

  it('does not return unsupported tool-use copy when the selected model exists but lacks tool calls', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: false }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useCurrentModelNotice());

    expect(result.current).toBeUndefined();
  });

  it('returns unavailable model copy when the selected model is enabled globally but absent from the chat selector list', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-image-1' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useCurrentModelNotice());

    expect(result.current).toBe('input.modelUnavailable');
  });

  it('does not return a notice when the ready model supports tool use', () => {
    testState.aiInfra.isInitAiProviderRuntimeState = true;
    testState.aiInfra.enabledChatModelList = [
      { children: [{ abilities: { functionCall: true }, id: 'gpt-4o' }], id: 'openai' },
    ];

    const { result } = renderHook(() => useCurrentModelNotice());

    expect(result.current).toBeUndefined();
  });

  it('does not return a notice for heterogeneous agents', () => {
    testState.agent.agencyConfig = { heterogeneousProvider: { type: 'codex' } };
    testState.aiInfra.isInitAiProviderRuntimeState = true;

    const { result } = renderHook(() => useCurrentModelNotice());

    expect(result.current).toBeUndefined();
  });
});
