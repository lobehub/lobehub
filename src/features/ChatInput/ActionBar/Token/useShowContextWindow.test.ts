import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useShowContextWindow } from './useShowContextWindow';

interface ModelPin {
  model: string;
  provider: string;
}

interface EnabledAiModel extends ModelPin {
  contextWindowTokens?: number;
}

const state = vi.hoisted(() => ({
  /** An active topic that no list or detail holds yet. */
  coldTopicId: undefined as string | undefined,
  enabledAiModels: [] as { contextWindowTokens?: number; id: string; providerId: string }[],
  topicModel: undefined as ModelPin | undefined,
  useFetchTopicDetail: vi.fn(),
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));

// The host publishes no topic of its own, so the composer follows the global active topic.
vi.mock('../../store', () => ({
  useChatInputStore: (selector: (s: object) => unknown) => selector({ topicId: undefined }),
}));

// Store boundary: the real `useEffectiveModel` and `aiModelSelectors` run against these states.
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) =>
    selector({
      agentMap: { 'agent-1': { model: 'agent-model', provider: 'agent-provider' } },
    }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      activeTopicId: state.topicModel ? 'topic-1' : state.coldTopicId,
      topicDataMap: {},
      useFetchTopicDetail: state.useFetchTopicDetail,
      topicDetailMap: state.topicModel ? { 'topic-1': { id: 'topic-1', ...state.topicModel } } : {},
    }),
}));

vi.mock('@/store/aiInfra', async () => ({
  aiModelSelectors: (await import('@/store/aiInfra/selectors')).aiModelSelectors,
  useAiInfraStore: (selector: (s: object) => unknown) =>
    selector({ enabledAiModels: state.enabledAiModels }),
}));

const setEnabledModels = (...models: EnabledAiModel[]) => {
  state.enabledAiModels = models.map(({ contextWindowTokens, model, provider }) => ({
    contextWindowTokens,
    id: model,
    providerId: provider,
  }));
};

const topicModel = { model: 'topic-model', provider: 'topic-provider' };

beforeEach(() => {
  state.coldTopicId = undefined;
  state.topicModel = undefined;
  state.useFetchTopicDetail.mockReset();
  setEnabledModels({ contextWindowTokens: 8000, model: 'agent-model', provider: 'agent-provider' });
});

describe('useShowContextWindow', () => {
  it('shows the ring when the agent default model has a context window', () => {
    expect(renderHook(() => useShowContextWindow()).result.current).toBe(true);
  });

  it('hides the ring for models without a context window', () => {
    setEnabledModels({ model: 'agent-model', provider: 'agent-provider' });

    expect(renderHook(() => useShowContextWindow()).result.current).toBe(false);
  });

  it('shows the ring when the topic pinned model has a context window but the agent default does not', () => {
    state.topicModel = topicModel;
    setEnabledModels(
      { model: 'agent-model', provider: 'agent-provider' },
      { contextWindowTokens: 16_000, ...topicModel },
    );

    expect(renderHook(() => useShowContextWindow()).result.current).toBe(true);
  });

  it('hides the ring when the agent default has a context window but the topic pinned model does not', () => {
    state.topicModel = topicModel;
    setEnabledModels(
      { contextWindowTokens: 8000, model: 'agent-model', provider: 'agent-provider' },
      topicModel,
    );

    expect(renderHook(() => useShowContextWindow()).result.current).toBe(false);
  });

  // `Token` returns before `TokenTag` (and its token-breakdown fetch) mounts
  // while this is false, so the gate itself has to load the topic it judges.
  it('loads a cold unlisted topic by id so its pinned model can unlock the ring', () => {
    state.coldTopicId = 'cold-topic';
    setEnabledModels(
      { model: 'agent-model', provider: 'agent-provider' },
      { contextWindowTokens: 16_000, ...topicModel },
    );

    const { rerender, result } = renderHook(() => useShowContextWindow());

    expect(state.useFetchTopicDetail).toHaveBeenLastCalledWith('cold-topic');
    expect(result.current).toBe(false);

    state.topicModel = topicModel;
    rerender();

    expect(result.current).toBe(true);
  });
});
