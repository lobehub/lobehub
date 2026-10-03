import type { HeterogeneousProviderConfig, HeterogeneousTopicPin } from '@lobechat/types';
import { applyTopicModelToHeterogeneousProvider } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHeteroProviderPatch } from './useHeteroProviderPatch';

const state = vi.hoisted(() => ({
  agent: { updateAgentConfigById: vi.fn() },
  chat: {
    activeTopicId: 'topic-a' as string | null,
    updateTopicHeteroPin: vi.fn(),
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
    state.chat.updateTopicHeteroPin.mockReset();
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

  /** @example Selecting medium/fast changes the Topic while its Agent default stays high/standard. */
  it('writes effort and speed together to the active topic', async () => {
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
    /** @example The shared Agent is unchanged by either Topic selection. */
    expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
  });

  /** @example A retains low/fast after B selects xhigh/standard on the same Agent. */
  it('keeps both topics independent, including an explicit standard speed', async () => {
    let agent: HeterogeneousProviderConfig = {
      effort: 'high',
      model: 'gpt-5.6-sol',
      speed: 'default',
      type: 'codex',
    };
    const topics: Record<string, HeterogeneousTopicPin> = {};
    state.chat.updateTopicHeteroPin.mockImplementation(
      async (id: string, pin: HeterogeneousTopicPin) => {
        const current = (topics[id] ??= {});
        if (pin.model !== undefined) current.model = pin.model;
        if (pin.provider !== undefined) current.provider = pin.provider;
        if (pin.effort !== undefined) current.effort = pin.effort;
        if (pin.speed !== undefined) current.speed = pin.speed;
      },
    );
    state.agent.updateAgentConfigById.mockImplementation(
      async (
        _id: string,
        value: { agencyConfig: { heterogeneousProvider: Partial<HeterogeneousProviderConfig> } },
      ) => {
        agent = { ...agent, ...value.agencyConfig.heterogeneousProvider };
      },
    );
    const { result, rerender } = renderHook(() =>
      useHeteroProviderPatch({ agentId: 'shared-agent', enabled: true, provider: agent }),
    );

    await act(() => result.current({ model: 'gpt-5.6-sol', effort: 'low', speed: 'fast' }));
    state.chat.activeTopicId = 'topic-b';
    rerender();
    await act(() => result.current({ model: 'gpt-5.6-terra', effort: 'xhigh', speed: 'default' }));

    // ROOT CAUSE:
    // The hook previously sent speed to updateAgentConfigById while model/effort went to Topic pins.
    // Topic B therefore replaced A's fast speed with the shared standard value.
    // The fix persists all three selections together and resolves speed from each Topic pin.
    /** @example Resolving A after B's write still returns Sol/low/fast. */
    expect(applyTopicModelToHeterogeneousProvider(agent, topics['topic-a'])).toMatchObject({
      effort: 'low',
      model: 'gpt-5.6-sol',
      speed: 'fast',
    });
    /** @example B's explicit Standard remains distinct from A's Fast. */
    expect(applyTopicModelToHeterogeneousProvider(agent, topics['topic-b'])).toMatchObject({
      effort: 'xhigh',
      model: 'gpt-5.6-terra',
      speed: 'default',
    });
    /** @example A new Topic still inherits the unchanged high/standard Agent default. */
    expect(applyTopicModelToHeterogeneousProvider(agent, undefined)).toMatchObject({
      effort: 'high',
      speed: 'default',
    });
    /** @example No Topic selection writes to the shared Agent. */
    expect(state.agent.updateAgentConfigById).not.toHaveBeenCalled();
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
