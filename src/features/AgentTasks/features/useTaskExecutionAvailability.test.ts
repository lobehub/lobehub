import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskExecutionAvailability } from './useTaskExecutionAvailability';

interface ModelPin {
  model: string;
  provider: string;
}

const state = vi.hoisted(() => ({
  agentModel: { model: 'agent-model', provider: 'agent-provider' } as ModelPin,
  isPreferenceLoading: false,
  toolUseModels: [] as ModelPin[],
  topicModel: undefined as ModelPin | undefined,
}));

vi.mock('@/features/ChatInput/hooks/effectiveAgentModePreference', () => ({
  useEffectiveAgentModePreference: () => ({
    enableAgentMode: true,
    isPreferenceLoading: state.isPreferenceLoading,
    usesWorkspaceMemberMode: false,
  }),
}));

// Store boundary: the real agent, topic and model selectors run against these states.
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) =>
    selector({
      activeAgentId: 'agent-1',
      agentMap: { 'agent-1': { ...state.agentModel } },
    }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      activeTopicId: state.topicModel ? 'topic-1' : undefined,
      topicDataMap: {},
      topicDetailMap: state.topicModel ? { 'topic-1': { id: 'topic-1', ...state.topicModel } } : {},
    }),
}));

vi.mock('@/store/aiInfra', async () => {
  const { aiModelSelectors, aiProviderSelectors } = await import('@/store/aiInfra/selectors');

  return {
    aiModelSelectors,
    aiProviderSelectors,
    useAiInfraStore: (selector: (s: object) => unknown) =>
      selector({
        enabledAiModels: state.toolUseModels.map(({ model, provider }) => ({
          abilities: { functionCall: true },
          id: model,
          providerId: provider,
        })),
        isInitAiProviderRuntimeState: true,
      }),
  };
});

const topicModel = { model: 'topic-model', provider: 'topic-provider' };

const renderAvailability = () =>
  renderHook(() => useTaskExecutionAvailability('agent-1')).result.current;

beforeEach(() => {
  state.agentModel = { model: 'agent-model', provider: 'agent-provider' };
  state.isPreferenceLoading = false;
  state.toolUseModels = [];
  state.topicModel = undefined;
});

// A task runs on its assignee's default model; whatever topic the chat page has
// active must not decide whether the task gets an execution environment.
describe('useTaskExecutionAvailability', () => {
  it('is available when the assignee default model supports tool use', () => {
    state.toolUseModels = [state.agentModel];

    expect(renderAvailability()).toBe(true);
  });

  it('is unavailable while the agent mode preference is loading', () => {
    state.isPreferenceLoading = true;
    state.toolUseModels = [state.agentModel];

    expect(renderAvailability()).toBe(false);
  });

  it('is unavailable when only the active chat topic model supports tool use', () => {
    state.topicModel = topicModel;
    state.toolUseModels = [topicModel];

    expect(renderAvailability()).toBe(false);
  });

  it('is available when the assignee default model supports tool use even if the active topic model does not', () => {
    state.topicModel = topicModel;
    state.toolUseModels = [state.agentModel];

    expect(renderAvailability()).toBe(true);
  });
});
