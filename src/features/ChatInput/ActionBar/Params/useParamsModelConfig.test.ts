import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useParamsModelConfig } from './useParamsModelConfig';

interface ModelConfig {
  disabledParams?: string[];
  extendParams?: string[];
}

interface ModelSelection {
  model: string;
  provider: string;
}

const testState = vi.hoisted(() => ({
  agentSelection: {
    model: 'agent-model',
    provider: 'agent-provider',
  } as ModelSelection,
  ai: {
    modelConfigs: {} as Record<string, ModelConfig>,
  },
  chat: {
    topicModel: undefined as ModelSelection | undefined,
  },
}));

vi.mock('../../hooks/useAgentModelSelection', () => ({
  useAgentModelSelection: () => testState.agentSelection,
}));

vi.mock('@/store/chat/slices/topic/projection', () => ({
  useActiveChatTopicModel: () => testState.chat.topicModel,
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    isModelHasExtendParams: (model: string, provider: string) => (state: typeof testState.ai) =>
      Boolean(state.modelConfigs[`${provider}:${model}`]?.extendParams?.length),
    modelDisabledParams: (model: string, provider: string) => (state: typeof testState.ai) =>
      state.modelConfigs[`${provider}:${model}`]?.disabledParams,
  },
  useAiInfraStore: <T>(selector: (state: typeof testState.ai) => T) => selector(testState.ai),
}));

describe('useParamsModelConfig', () => {
  beforeEach(() => {
    testState.agentSelection = {
      model: 'agent-model',
      provider: 'agent-provider',
    };
    testState.chat.topicModel = undefined;
    testState.ai.modelConfigs = {
      'agent-provider:agent-model': {
        disabledParams: ['temperature'],
      },
      'topic-provider:topic-model': {
        disabledParams: ['top_p'],
        extendParams: ['reasoningEffort'],
      },
    };
  });

  it('uses the active topic model for parameter capabilities', () => {
    testState.chat.topicModel = {
      model: 'topic-model',
      provider: 'topic-provider',
    };

    const { result } = renderHook(() => useParamsModelConfig('agent-1'));

    expect(result.current).toEqual({
      disabledParams: ['top_p'],
      hasModelConfig: true,
      model: 'topic-model',
      provider: 'topic-provider',
    });
  });

  it('falls back to the resolved agent selection when no topic model is pinned', () => {
    const { result } = renderHook(() => useParamsModelConfig('agent-1'));

    expect(result.current).toEqual({
      disabledParams: ['temperature'],
      hasModelConfig: false,
      model: 'agent-model',
      provider: 'agent-provider',
    });
  });
});
