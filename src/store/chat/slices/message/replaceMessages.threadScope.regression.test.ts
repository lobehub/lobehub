import { type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../store';

vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return { ...actual, mutate: vi.fn() };
});
vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response('mock'))),
);
vi.mock('@/services/message', () => ({
  messageService: {
    createMessage: vi.fn(),
    getMessages: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageError: vi.fn(),
  },
}));
vi.mock('@/services/topic', () => ({ topicService: {} }));

const THREAD_CTX = { agentId: 'agent-1', threadId: 'thread-1', topicId: 'topic-1' };

/**
 * Shape of `MessageModel.query({ threadId })`: the unthreaded ancestors the thread hangs off,
 * followed by the thread's own replies.
 */
const threadQuery = [
  { content: 'Question', createdAt: 1, id: 'user-1', role: 'user', updatedAt: 1 },
  {
    content: 'Answer',
    createdAt: 2,
    id: 'asst-1',
    parentId: 'user-1',
    role: 'assistant',
    updatedAt: 2,
  },
  {
    content: 'Thread question',
    createdAt: 3,
    id: 'thr-1',
    parentId: 'asst-1',
    role: 'user',
    threadId: 'thread-1',
    updatedAt: 3,
  },
  {
    content: 'Thread answer',
    createdAt: 4,
    id: 'thr-2',
    parentId: 'thr-1',
    role: 'assistant',
    threadId: 'thread-1',
    updatedAt: 4,
  },
] as UIChatMessage[];

describe('replaceMessages — thread-scoped parse', () => {
  beforeEach(() => {
    useChatStore.setState({ dbMessagesMap: {}, messagesMap: {} });
  });

  it('keeps the thread replies next to their ancestors in the thread view', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.replaceMessages(threadQuery, { context: THREAD_CTX });
    });

    const display = result.current.messagesMap[messageMapKey(THREAD_CTX)] ?? [];
    expect(display.map((m) => m.id)).toEqual(['user-1', 'asst-1', 'thr-1', 'thr-2']);
  });
});
