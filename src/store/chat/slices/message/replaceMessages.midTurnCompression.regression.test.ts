import { type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../store';

// `replaceMessages` is pure store + conversation-flow `parse` (no service
// calls), but importing the chat store pulls the whole slice graph, so mirror
// the minimal service / swr / zustand stubs the sibling action tests use.
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

const CTX = { agentId: 'agent-1', topicId: 'topic-1' };
const KEY = messageMapKey(CTX);

const STREAMED_REPLY = 'Starting with Dutch, then the remaining four.';

const historyUser: UIChatMessage = {
  content: 'old history',
  createdAt: 1000,
  id: 'msg-old',
  role: 'user',
  updatedAt: 1000,
};
const historyAssistant: UIChatMessage = {
  content: 'old reply',
  createdAt: 2000,
  id: 'msg-old-asst',
  parentId: 'msg-old',
  role: 'assistant',
  updatedAt: 2000,
};
const currentUser: UIChatMessage = {
  content: 'continue with the other languages',
  createdAt: 3000,
  id: 'msg-current-user',
  parentId: 'msg-old-asst',
  role: 'user',
  updatedAt: 3000,
};
const inFlightAssistant: UIChatMessage = {
  content: STREAMED_REPLY,
  createdAt: 4000,
  id: 'msg-inflight-asst',
  parentId: 'msg-current-user',
  role: 'assistant',
  tools: [
    {
      apiName: 'crawl',
      arguments: '{}',
      id: 'msg-inflight-tool',
      identifier: 'lobe-web-browsing',
      type: 'builtin',
    },
  ],
  updatedAt: 4000,
};
const inFlightTool: UIChatMessage = {
  content: 'crawl result',
  createdAt: 4100,
  id: 'msg-inflight-tool',
  parentId: 'msg-inflight-asst',
  role: 'tool',
  tool_call_id: 'msg-inflight-tool',
  updatedAt: 4100,
};

const liveTranscript = [
  historyUser,
  historyAssistant,
  currentUser,
  inFlightAssistant,
  inFlightTool,
];

/**
 * What a mid-turn compression snapshot looks like when the already-streamed
 * turn is nested inside `compressedGroup` and only the latest user stays
 * on the mainline.
 */
const postCompressionSnapshot: UIChatMessage[] = [
  {
    compressedMessages: [historyUser, historyAssistant, inFlightAssistant, inFlightTool],
    content: 'historical summary',
    createdAt: 1500,
    id: 'mg-compress',
    lastMessageId: 'msg-inflight-tool',
    role: 'compressedGroup',
    updatedAt: 4500,
  } as UIChatMessage,
  currentUser,
];

const displayHasStreamedReply = (messages: UIChatMessage[]) =>
  messages.some((message) => {
    if (message.id === 'msg-inflight-asst' || message.content === STREAMED_REPLY) return true;
    if (message.role !== 'assistantGroup') return false;
    return (message.children ?? []).some(
      (child) => child.id === 'msg-inflight-asst' || child.content === STREAMED_REPLY,
    );
  });

describe('replaceMessages — mid-turn compression swallows streamed reply', () => {
  beforeEach(() => {
    useChatStore.setState({ activeAgentId: 'agent-1', activeTopicId: 'topic-1' }, false);
  });

  it('keeps the streamed assistant visible after a post-compression snapshot omits it from the mainline', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.replaceMessages(liveTranscript, { context: CTX });
    });
    expect(displayHasStreamedReply(result.current.messagesMap[KEY] ?? [])).toBe(true);

    act(() => {
      result.current.replaceMessages(postCompressionSnapshot, {
        action: 'gateway/step_start',
        context: CTX,
      });
    });

    expect(displayHasStreamedReply(result.current.messagesMap[KEY] ?? [])).toBe(true);
  });
});
