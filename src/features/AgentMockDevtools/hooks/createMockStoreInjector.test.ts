import type { ConversationContext } from '@lobechat/types';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createMockStoreInjector } from './createMockStoreInjector';

describe('createMockStoreInjector', () => {
  beforeEach(() => {
    useChatStore.setState({
      activeAgentId: 'agent-1',
      activeTopicId: undefined,
      dbMessagesMap: {},
      messageOperationMap: {},
      messagesMap: {},
      operations: {},
      operationsByContext: {},
      operationsByMessage: {},
      operationsByType: {} as any,
      toolCallingStreamIds: {},
    });
  });

  it('writes mock stream chunks into the chat store message maps', () => {
    const context = {
      agentId: 'agent-1',
      scope: 'main',
      topicId: null,
    } satisfies ConversationContext;

    const { operationId } = useChatStore.getState().startOperation({
      context,
      type: 'execAgentRuntime',
    });
    const assistantMessageId = 'mock-msg-1';

    useChatStore.getState().optimisticCreateTmpMessage(
      {
        agentId: context.agentId,
        content: '',
        role: 'assistant',
        topicId: undefined,
      },
      { operationId, tempMessageId: assistantMessageId },
    );

    const inject = createMockStoreInjector(() => useChatStore.getState(), {
      assistantMessageId,
      context,
      operationId,
    });

    act(() => {
      inject({
        data: { chunkType: 'text', content: 'hello' },
        operationId,
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'stream_chunk',
      });
    });

    const key = messageMapKey(context);
    expect(useChatStore.getState().dbMessagesMap[key]).toMatchObject([
      { content: 'hello', id: assistantMessageId, role: 'assistant' },
    ]);
    expect(useChatStore.getState().messagesMap[key]).toMatchObject([
      { content: 'hello', id: assistantMessageId, role: 'assistant' },
    ]);
  });

  it('writes stream chunks into a thread-scoped message bucket', () => {
    const context = {
      agentId: 'agent-1',
      scope: 'thread',
      threadId: 'thread-1',
      topicId: 'topic-1',
    } satisfies ConversationContext;

    const { operationId } = useChatStore.getState().startOperation({
      context,
      type: 'execAgentRuntime',
    });
    const assistantMessageId = 'mock-thread-msg-1';

    useChatStore.getState().optimisticCreateTmpMessage(
      {
        agentId: context.agentId,
        content: '',
        role: 'assistant',
        threadId: context.threadId,
        topicId: context.topicId,
      },
      { operationId, tempMessageId: assistantMessageId },
    );

    const inject = createMockStoreInjector(() => useChatStore.getState(), {
      assistantMessageId,
      context,
      operationId,
    });

    act(() => {
      inject({
        data: { chunkType: 'text', content: 'thread hello' },
        operationId,
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'stream_chunk',
      });
    });

    const key = messageMapKey(context);
    expect(useChatStore.getState().dbMessagesMap[key]).toMatchObject([
      { content: 'thread hello', id: assistantMessageId, role: 'assistant' },
    ]);
    expect(useChatStore.getState().dbMessagesMap['main_agent-1_topic-1']).toBeUndefined();
  });
});
