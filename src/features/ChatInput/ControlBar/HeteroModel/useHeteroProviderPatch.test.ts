import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHeteroProviderPatch } from './useHeteroProviderPatch';

const state = vi.hoisted(() => ({
  agent: { updateAgentConfigById: vi.fn() },
  chat: {
    activeTopicId: 'topic-a' as string | null,
    updateTopicModel: vi.fn(),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (value: typeof state.agent) => unknown) => selector(state.agent),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (value: typeof state.chat) => unknown) => selector(state.chat),
}));

describe('useHeteroProviderPatch', () => {
  beforeEach(() => {
    state.agent.updateAgentConfigById.mockReset();
    state.chat.activeTopicId = 'topic-a';
    state.chat.updateTopicModel.mockReset();
  });

  it('writes a model selection to the active topic without changing the Agent default', async () => {
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { model: 'global-model', type: 'cursor' },
      }),
    );

    await act(() => result.current({ model: 'topic-model' }));

    expect(state.chat.updateTopicModel).toHaveBeenCalledWith('topic-a', {
      model: 'topic-model',
      provider: 'cursor',
    });
    expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('keeps non-model compatibility resets global when selecting a topic model', async () => {
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { effort: 'high', model: 'global-model', type: 'codex' },
      }),
    );

    await act(() => result.current({ effort: 'default', model: 'topic-model' }));

    expect(state.chat.updateTopicModel).toHaveBeenCalledWith('topic-a', {
      model: 'topic-model',
      provider: 'codex',
    });
    expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-a', {
      agencyConfig: {
        heterogeneousProvider: { args: undefined, effort: 'default' },
      },
    });
  });

  it('updates the Agent default when there is no active topic', async () => {
    state.chat.activeTopicId = null;
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { model: 'global-model', type: 'cursor' },
      }),
    );

    await act(() => result.current({ model: 'next-default' }));

    expect(state.chat.updateTopicModel).not.toHaveBeenCalled();
    expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-a', {
      agencyConfig: {
        heterogeneousProvider: { args: undefined, model: 'next-default' },
      },
    });
  });
});
