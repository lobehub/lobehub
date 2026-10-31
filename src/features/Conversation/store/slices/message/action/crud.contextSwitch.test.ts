import { type UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as messageServiceModule from '@/services/message';
import { useChatStore } from '@/store/chat';
import { getMessageTranscript } from '@/store/chat/slices/message/transcript';
import { evictMessageCache } from '@/store/chat/utils/evictMessageCache';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type ConversationContext } from '../../../../types';
import { createStore } from '../../../index';

// Mock conversation-flow parse so createStore initialization never reaches a real parser.
vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => {
    const messageMap: Record<string, UIChatMessage> = {};
    for (const msg of messages) messageMap[msg.id] = msg;
    const flatList = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    return { flatList, messageMap };
  },
}));

const createTestStore = (context?: Partial<ConversationContext>) =>
  createStore({
    context: {
      agentId: 'agent-1',
      topicId: 'topic-1',
      threadId: null,
      ...context,
    },
  });

describe('createMessage across a conversation switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles a late success in the context it was created in', async () => {
    let resolveCreate!: (result: any) => void;
    vi.spyOn(messageServiceModule.messageService, 'createMessage').mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const oldContext = {
      agentId: 'test-session',
      threadId: null,
      topicId: 'topic-old',
    };
    const currentContext = {
      agentId: 'test-session',
      threadId: null,
      topicId: 'topic-current',
    };
    const currentMessages: UIChatMessage[] = [
      {
        content: 'current topic',
        createdAt: 2000,
        id: 'msg-current',
        role: 'user',
        updatedAt: 2000,
      },
    ];
    const store = createTestStore(oldContext);

    const createPromise = store.getState().createMessage({
      content: 'old topic message',
      role: 'user',
    });
    const oldBucketKey = messageMapKey(oldContext);
    const tempId = useChatStore.getState().dbMessagesMap[oldBucketKey]?.[0]?.id;
    expect(tempId).toMatch(/^tmp_/);

    store.setState({
      context: currentContext,
      dbMessages: currentMessages,
      displayMessages: currentMessages,
      messageLoadingIds: [],
      messagesInit: true,
    });

    let result: string | undefined;
    await act(async () => {
      resolveCreate({
        id: 'msg-old',
        messages: [
          {
            content: 'late old topic result',
            createdAt: 1000,
            id: 'msg-old',
            role: 'user',
            updatedAt: 1000,
          },
        ],
      });
      result = await createPromise;
    });

    expect(result).toBeUndefined();
    expect(store.getState().dbMessages).toEqual(currentMessages);

    // The temp row lives in the context it was created in, so the late
    // success settles that bucket instead of leaving a ghost behind.
    const settled = useChatStore.getState().dbMessagesMap[oldBucketKey];
    expect(settled?.map((message) => message.id)).toEqual(['msg-old']);
    const transcript = getMessageTranscript(useChatStore.setState, useChatStore.getState);
    expect(transcript.debugUnconfirmedClientIds()).not.toContain(tempId);
  });

  it('settles a late failure in the context it was created in', async () => {
    let rejectCreate!: (error: Error) => void;
    vi.spyOn(messageServiceModule.messageService, 'createMessage').mockReturnValue(
      new Promise((_, reject) => {
        rejectCreate = reject;
      }) as any,
    );

    const oldContext = {
      agentId: 'test-session',
      threadId: null,
      topicId: 'topic-old',
    };
    const currentContext = {
      agentId: 'test-session',
      threadId: null,
      topicId: 'topic-current',
    };
    const store = createTestStore(oldContext);

    const createPromise = store.getState().createMessage({
      content: 'old topic message',
      role: 'user',
    });
    const oldBucketKey = messageMapKey(oldContext);
    const tempId = useChatStore.getState().dbMessagesMap[oldBucketKey]?.[0]?.id;

    store.setState({
      context: currentContext,
      dbMessages: [],
      displayMessages: [],
      messageLoadingIds: [],
      messagesInit: true,
    });

    await act(async () => {
      rejectCreate(new Error('Creation failed'));
      await createPromise;
    });

    // The failed row is settled where it lives, not left as a sending ghost.
    const settled = useChatStore.getState().dbMessagesMap[oldBucketKey];
    expect(settled?.[0].id).toBe(tempId);
    expect(settled?.[0].error).toBeDefined();
  });

  it('does not restore a conversation evicted while a create was pending', async () => {
    let resolveCreate!: (result: any) => void;
    vi.spyOn(messageServiceModule.messageService, 'createMessage').mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const oldContext = {
      agentId: 'test-session',
      threadId: null,
      topicId: 'topic-old',
    };
    const currentContext = {
      agentId: 'test-session',
      threadId: null,
      topicId: 'topic-current',
    };
    const store = createTestStore(oldContext);

    const createPromise = store.getState().createMessage({
      content: 'old topic message',
      role: 'user',
    });
    const oldBucketKey = messageMapKey(oldContext);
    expect(useChatStore.getState().dbMessagesMap[oldBucketKey]).toBeDefined();

    store.setState({
      context: currentContext,
      dbMessages: [],
      displayMessages: [],
      messageLoadingIds: [],
      messagesInit: true,
    });

    await act(() => evictMessageCache((ctx) => ctx.topicId === 'topic-old'));
    expect(useChatStore.getState().dbMessagesMap[oldBucketKey]).toBeUndefined();

    await act(async () => {
      resolveCreate({
        id: 'msg-old',
        messages: [
          {
            content: 'late old topic result',
            createdAt: 1000,
            id: 'msg-old',
            role: 'user',
            updatedAt: 1000,
          },
        ],
      });
      await createPromise;
    });

    // The late response must not recreate the deleted transcript.
    expect(useChatStore.getState().dbMessagesMap[oldBucketKey]).toBeUndefined();
  });
});
