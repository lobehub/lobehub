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
    activeTopicId: undefined as string | undefined,
    topicModels: {} as Record<string, ModelSelection>,
  },
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
}));

vi.mock('../../hooks/useAgentModelSelection', () => ({
  useAgentModelSelection: () => testState.agentSelection,
}));

vi.mock('../../store', () => ({
  useChatInputStore: (selector: (state: object) => unknown) =>
    selector({ topicId: testState.composerTopicId }),
}));

// Store boundary: the real topic selectors run against this state.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) =>
    selector({
      activeTopicId: testState.chat.activeTopicId,
      topicDataMap: {},
      useFetchTopicDetail: () => {},
      topicDetailMap: Object.fromEntries(
        Object.entries(testState.chat.topicModels).map(([id, pin]) => [id, { id, ...pin }]),
      ),
    }),
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
    testState.chat.activeTopicId = undefined;
    testState.chat.topicModels = {};
    testState.composerTopicId = undefined;
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
    testState.chat.activeTopicId = 'topic-1';
    testState.chat.topicModels = {
      'topic-1': { model: 'topic-model', provider: 'topic-provider' },
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

  // A page copilot embedded beside a chat runs with `topicId: null` while the
  // outer chat's topic is still the global active one.
  it('ignores the global active topic pin when the composer conversation has no topic', () => {
    testState.chat.activeTopicId = 'topic-1';
    testState.chat.topicModels = {
      'topic-1': { model: 'topic-model', provider: 'topic-provider' },
    };
    testState.composerTopicId = null;

    const { result } = renderHook(() => useParamsModelConfig('agent-1'));

    expect(result.current).toMatchObject({ model: 'agent-model', provider: 'agent-provider' });
  });
});
