import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPendingSandboxSelection } from '@/store/chat/pendingSandboxSelection';

import { useSandboxMode } from './useSandboxMode';

interface TopicSandbox {
  sandboxInstanceId?: string;
  sandboxMode?: 'ephemeral' | 'persistent';
}

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  topics: {} as Record<string, TopicSandbox>,
  updateTopicMetadata: vi.fn(),
}));

// Store boundary: the real topic selectors run against this state.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      activeTopicId: state.activeTopicId,
      topicDataMap: {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.topics).map(([id, metadata]) => [id, { id, metadata }]),
      ),
      updateTopicMetadata: state.updateTopicMetadata,
    }),
}));

beforeEach(() => {
  // The main column's topic stays globally active while a side pane renders another.
  state.activeTopicId = 'main-topic';
  state.topics = {
    'main-topic': { sandboxInstanceId: 'main-instance', sandboxMode: 'persistent' },
    'pane-topic': { sandboxMode: 'ephemeral' },
  };
  state.updateTopicMetadata.mockReset();
});

describe('useSandboxMode', () => {
  it('reads and writes the given topic instead of the global active topic', async () => {
    const { result } = renderHook(() => useSandboxMode('agent-1', 'pane-topic'));

    expect(result.current.selection).toEqual({ instanceId: undefined, mode: 'ephemeral' });
    expect(result.current.topicId).toBe('pane-topic');

    await act(() =>
      result.current.setSelection({ instanceId: 'pane-instance', mode: 'persistent' }),
    );

    expect(state.updateTopicMetadata).toHaveBeenCalledWith('pane-topic', {
      sandboxInstanceId: 'pane-instance',
      sandboxMode: 'persistent',
    });
  });

  it('buffers the choice for a conversation without a topic even while another topic is active', async () => {
    const { result } = renderHook(() => useSandboxMode('agent-new-topic', null));

    expect(result.current.selection).toEqual({});
    expect(result.current.topicId).toBeUndefined();

    await act(() => result.current.setSelection({ mode: 'persistent' }));

    expect(state.updateTopicMetadata).not.toHaveBeenCalled();
    expect(getPendingSandboxSelection('agent-new-topic')).toEqual({ mode: 'persistent' });
  });

  it('follows the global active topic when no topic is given', () => {
    const { result } = renderHook(() => useSandboxMode('agent-1'));

    expect(result.current.selection).toEqual({
      instanceId: 'main-instance',
      mode: 'persistent',
    });
    expect(result.current.topicId).toBe('main-topic');
  });
});
