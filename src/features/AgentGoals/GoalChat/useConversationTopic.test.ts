import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationTopic } from './useConversationTopic';

const conversation = vi.hoisted(() => ({ context: { topicId: 'tpc_goal' as string | null } }));

const chat = vi.hoisted(() => ({
  state: {} as {
    activeTopicId: string | null;
    topics: { id: string; title: string }[];
  },
}));

vi.mock('@/features/Conversation', () => ({
  conversationSelectors: { topicId: (s: typeof conversation) => s.context.topicId },
  useConversationStore: (selector: (s: typeof conversation) => unknown) => selector(conversation),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: typeof chat.state) => unknown) => selector(chat.state),
}));

vi.mock('@/store/chat/slices/topic/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (s: typeof chat.state) => s.topics.find((t) => t.id === id),
  },
}));

beforeEach(() => {
  conversation.context = { topicId: 'tpc_goal' };
  chat.state = {
    activeTopicId: 'tpc_goal',
    topics: [
      { id: 'tpc_goal', title: 'Supervision record' },
      { id: 'tpc_task', title: 'Task manager chat' },
    ],
  };
});

describe('useConversationTopic', () => {
  // ROOT CAUSE (T-14085): the goal panel header read the store's active topic.
  // On the agent-less goal route the task manager panel can move that topic
  // after the supervision record opened, so the header lost the record's title
  // and topic menu. The header now follows its own conversation's topic.
  it('keeps the conversation’s own topic when the store’s active topic moved', () => {
    chat.state.activeTopicId = null;
    expect(renderHook(() => useConversationTopic()).result.current?.id).toBe('tpc_goal');

    chat.state.activeTopicId = 'tpc_task';
    expect(renderHook(() => useConversationTopic()).result.current?.id).toBe('tpc_goal');
  });

  it('has no topic while the conversation has none', () => {
    conversation.context.topicId = null;
    expect(renderHook(() => useConversationTopic()).result.current).toBeUndefined();
  });
});
