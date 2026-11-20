/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStartTopicConversation } from './useStartTopicConversation';

const state = vi.hoisted(() => ({ context: {} as Record<string, unknown> }));

vi.mock('../store', () => ({
  useConversationStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

describe('useStartTopicConversation', () => {
  afterEach(() => {
    state.context = {};
  });

  it('returns the agent and topic of a main conversation', () => {
    state.context = { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' };

    const { result } = renderHook(() => useStartTopicConversation());

    expect(result.current).toEqual({ agentId: 'agent-1', topicId: 'topic-1' });
  });

  it('treats a new main topic as the null topic', () => {
    state.context = { agentId: 'agent-1' };

    const { result } = renderHook(() => useStartTopicConversation());

    expect(result.current).toEqual({ agentId: 'agent-1', topicId: null });
  });

  it.each(['page', 'task', 'thread', 'group', 'agent_builder'])(
    'is unavailable in a %s conversation',
    (scope) => {
      // These conversations own their scope/bucket; the global switchTopic(null)
      // would clear the main chat underneath instead.
      state.context = { agentId: 'agent-1', scope, topicId: 'topic-1' };

      const { result } = renderHook(() => useStartTopicConversation());

      expect(result.current).toBeUndefined();
    },
  );

  it('is unavailable in a group conversation or a share view', () => {
    for (const extra of [{ groupId: 'group-1' }, { topicShareId: 's' }, { agentShareId: 's' }]) {
      state.context = { agentId: 'agent-1', scope: 'main', ...extra };

      const { result } = renderHook(() => useStartTopicConversation());

      expect(result.current).toBeUndefined();
    }
  });
});
