import type { SharedAgentData } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchAgentMap = vi.fn();

// A tiny fake chat store: `chatState` is the "current" state, `setState`
// merges into it the same way zustand's `setState` does. Kept as a plain
// object (not a real zustand store) so the test can assert on the exact
// partials the hook pushes without pulling in the real chat slices.
let chatState: { activeTopicId?: string } = {};

vi.mock('@/store/agent', () => ({
  useAgentStore: {
    getState: () => ({ internal_dispatchAgentMap: dispatchAgentMap }),
    setState: vi.fn(),
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => chatState,
    setState: (partial: Partial<typeof chatState>) => {
      chatState = { ...chatState, ...partial };
    },
  },
}));

const { useVisitorConversationSeed } = await import('./useVisitorConversationSeed');

const baseAgentMeta: SharedAgentData['agentMeta'] = {
  avatar: null,
  backgroundColor: null,
  description: null,
  marketIdentifier: null,
  name: 'Agent',
  slug: null,
  title: null,
};

const baseIdentity = { agentId: 'agent-1', agentMeta: baseAgentMeta, shareId: 'share-1' };

describe('useVisitorConversationSeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatState = {};
  });

  it('reports seeded once the identity effect has landed', () => {
    const { result } = renderHook(() => useVisitorConversationSeed(baseIdentity));

    expect(result.current).toBe(true);
    expect(chatState.activeTopicId).toBeUndefined();
  });

  it('preserves the selected topic when only `agentMeta` gets a fresh object reference', () => {
    const { rerender } = renderHook((props) => useVisitorConversationSeed(props), {
      initialProps: baseIdentity,
    });

    // Simulate the visitor having opened an existing topic after the initial seed.
    chatState = { ...chatState, activeTopicId: 'topic-1' };

    // SWR's `refreshSharedAgentStatus` (e.g. after the composer's "Retry")
    // resolves a brand-new `agentMeta` object even when nothing about the
    // agent identity changed.
    rerender({ ...baseIdentity, agentMeta: { ...baseAgentMeta } });

    expect(chatState.activeTopicId).toBe('topic-1');
  });

  it('still resets the selected topic when the agent identity actually changes', () => {
    const { rerender } = renderHook((props) => useVisitorConversationSeed(props), {
      initialProps: baseIdentity,
    });

    chatState = { ...chatState, activeTopicId: 'topic-1' };

    rerender({ ...baseIdentity, agentId: 'agent-2' });

    expect(chatState.activeTopicId).toBeUndefined();
  });

  it('still resets the selected topic when the share identity changes for the same agent', () => {
    const { rerender } = renderHook((props) => useVisitorConversationSeed(props), {
      initialProps: baseIdentity,
    });

    chatState = { ...chatState, activeTopicId: 'topic-1' };

    rerender({ ...baseIdentity, shareId: 'share-2' });

    expect(chatState.activeTopicId).toBeUndefined();
  });

  it('still re-seeds the agentMap on a metadata-only refresh, so header info stays fresh', () => {
    const { rerender } = renderHook((props) => useVisitorConversationSeed(props), {
      initialProps: baseIdentity,
    });
    dispatchAgentMap.mockClear();

    rerender({ ...baseIdentity, agentMeta: { ...baseAgentMeta, name: 'Renamed Agent' } });

    expect(dispatchAgentMap).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ name: 'Renamed Agent' }),
    );
  });
});
