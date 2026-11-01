import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHeteroProviderPatch } from './useHeteroProviderPatch';

const state = vi.hoisted(() => ({
  agent: { updateAgentConfigById: vi.fn() },
  chat: {
    activeTopicId: 'topic-a' as string | null,
    updateTopicHeteroPin: vi.fn(),
  },
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
}));

vi.mock('../../store', () => ({
  useChatInputStore: (selector: (value: object) => unknown) =>
    selector({ topicId: state.composerTopicId }),
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
    state.chat.updateTopicHeteroPin.mockReset();
    state.composerTopicId = undefined;
  });

  // A side-by-side portal pane renders another topic while the main column's
  // topic stays globally active.
  it("pins the composer's own topic rather than the global active topic", async () => {
    state.composerTopicId = 'topic-pane';
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { model: 'global-model', type: 'codex' },
      }),
    );

    await act(() => result.current({ model: 'pane-model' }));

    expect(state.chat.updateTopicHeteroPin).toHaveBeenCalledWith('topic-pane', {
      effort: undefined,
      model: 'pane-model',
      provider: 'codex',
    });
  });

  it('updates the Agent default when the composer conversation has no topic, even with an active topic', async () => {
    state.composerTopicId = null;
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { model: 'global-model', type: 'cursor' },
      }),
    );

    await act(() => result.current({ model: 'next-default' }));

    expect(state.chat.updateTopicHeteroPin).not.toHaveBeenCalled();
    expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-a', {
      agencyConfig: {
        heterogeneousProvider: { args: undefined, model: 'next-default' },
      },
    });
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

    expect(state.chat.updateTopicHeteroPin).toHaveBeenCalledWith('topic-a', {
      effort: undefined,
      model: 'topic-model',
      provider: 'cursor',
    });
    expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('writes model and effort selections to the active topic, never the Agent default', async () => {
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { effort: 'high', model: 'global-model', type: 'codex' },
      }),
    );

    await act(() => result.current({ effort: 'default', model: 'topic-model' }));

    expect(state.chat.updateTopicHeteroPin).toHaveBeenCalledWith('topic-a', {
      effort: 'default',
      model: 'topic-model',
      provider: 'codex',
    });
    expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('writes a speed selection to the active topic without changing the Agent default', async () => {
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { effort: 'high', model: 'global-model', type: 'codex' },
      }),
    );

    await act(() => result.current({ effort: 'medium', speed: 'fast' }));

    expect(state.chat.updateTopicHeteroPin).toHaveBeenCalledWith('topic-a', {
      effort: 'medium',
      model: undefined,
      provider: 'codex',
      speed: 'fast',
    });
    expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('keeps the mode selection on the Agent default', async () => {
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { type: 'amp' },
      }),
    );

    await act(() => result.current({ mode: 'high' }));

    expect(state.chat.updateTopicHeteroPin).not.toHaveBeenCalled();
    expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-a', {
      agencyConfig: { heterogeneousProvider: expect.objectContaining({ mode: 'high' }) },
    });
  });

  it('writes the effort to the Agent default when there is no active topic', async () => {
    state.chat.activeTopicId = null;
    const { result } = renderHook(() =>
      useHeteroProviderPatch({
        agentId: 'agent-a',
        enabled: true,
        provider: { effort: 'high', model: 'global-model', type: 'codex' },
      }),
    );

    await act(() => result.current({ effort: 'default' }));

    expect(state.chat.updateTopicHeteroPin).not.toHaveBeenCalled();
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

    expect(state.chat.updateTopicHeteroPin).not.toHaveBeenCalled();
    expect(state.agent.updateAgentConfigById).toHaveBeenCalledWith('agent-a', {
      agencyConfig: {
        heterogeneousProvider: { args: undefined, model: 'next-default' },
      },
    });
  });
});
