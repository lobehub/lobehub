import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type ConversationContext } from '../../../types';
import { createStore } from '../../index';

vi.mock('@/services/topic', () => ({
  topicService: { branchTopicAtMessage: vi.fn(), cancelRateLimitContinuation: vi.fn() },
}));
vi.mock('@/services/message/roundCursorPage', () => ({ isPartialHeadWindow: () => true }));

const context: ConversationContext = { agentId: 'session-1', threadId: null, topicId: 'topic-1' };
const key = messageMapKey(context);

const olderRound = [
  { content: 'older question', id: 'msg-0', role: 'user' },
  { content: 'older answer', id: 'msg-0a', parentId: 'msg-0', role: 'assistant' },
];
const headRound = [
  { content: 'Hello', id: 'msg-1', parentId: 'msg-0a', role: 'user' },
  {
    children: [{ content: 'Hi there', id: 'child-1' }],
    content: '',
    id: 'group-1',
    parentId: 'msg-1',
    role: 'assistantGroup',
  },
];

const chatState: Record<string, any> = {};
const executeClientAgent = vi.fn();
const refreshMessages = vi.fn(async () => {
  chatState.messagesMap = { [key]: [...olderRound, ...headRound] };
});

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: vi.fn(() => chatState), setState: vi.fn() },
}));

describe('client-mode runs on a partial head page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(chatState, {
      associateMessageWithOperation: vi.fn(),
      completeOperation: vi.fn(),
      dbMessagesMap: {},
      executeClientAgent,
      failOperation: vi.fn(),
      isGatewayModeEnabled: () => false,
      messagesMap: { [key]: headRound },
      operations: {},
      operationsByMessage: {},
      refreshMessages,
      startOperation: vi.fn(() => ({ operationId: 'op-1' })),
      switchMessageBranch: vi.fn(),
      topicDataMap: {},
    });
  });

  it('regenerates with the full history', async () => {
    const store = createStore({ context });
    act(() => store.setState({ displayMessages: headRound } as any));

    await act(async () => {
      await store.getState().regenerateUserMessage('msg-1');
    });

    expect(refreshMessages).toHaveBeenCalledWith(context);
    expect(executeClientAgent.mock.calls[0][0].messages.map((m: { id: string }) => m.id)).toEqual([
      'msg-0',
      'msg-0a',
      'msg-1',
    ]);
  });

  it('continues with the full history', async () => {
    const store = createStore({ context });
    act(() => store.setState({ displayMessages: headRound } as any));

    await act(async () => {
      await store.getState().continueGeneration('group-1');
    });

    expect(refreshMessages).toHaveBeenCalledWith(context);
    expect(executeClientAgent.mock.calls[0][0].messages.map((m: { id: string }) => m.id)).toEqual([
      'msg-0',
      'msg-0a',
      'msg-1',
      'group-1',
    ]);
  });
});
