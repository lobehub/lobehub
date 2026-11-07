import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { conversationMessagesKey } from '@/services/message/replica';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createStore } from '../../index';
import { createEphemeralResetState } from '../../initialState';
import { dataSelectors } from './selectors';

vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => ({
    flatList: [...messages].sort((a, b) => a.createdAt - b.createdAt),
    messageMap: Object.fromEntries(messages.map((m) => [m.id, m])),
  }),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { message: { getMessagesByCursor: { query: vi.fn() } } },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => undefined,
  useActiveWorkspaceId: () => undefined,
}));

const query = vi.mocked(lambdaClient.message.getMessagesByCursor.query);

const row = (id: string, createdAt: number) =>
  ({ content: id, createdAt, id, role: 'user' }) as UIChatMessage;

const cursor = { createdAt: '2024-01-01T00:00:01.000Z', id: 'a1' };

const forward = (shareId: string): ConversationContext => ({
  agentId: 'share-agent',
  messageReadMode: 'forward',
  topicId: `topic-${shareId}`,
  topicShareId: shareId,
});

const seedFirstPage = (context: ConversationContext) =>
  useChatStore.setState((state) => ({
    dbMessagesMap: {
      ...state.dbMessagesMap,
      [messageMapKey(context)]: [row('u1', 0), row('a1', 1)],
    },
    messagePagingMap: {
      ...state.messagePagingMap,
      [conversationMessagesKey(context)]: {
        currentPage: 0,
        hasMore: true,
        nextCursor: cursor,
        pageSize: 2,
      },
    },
  }));

const laterPage = {
  direction: 'forward' as const,
  hasMore: false,
  messages: [row('u2', 2), row('a2', 3)],
  nextCursor: null,
};

describe('loadLaterMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({ dbMessagesMap: {}, messagePagingMap: {}, messagesMap: {} });
  });

  it('appends the next rounds below the loaded ones', async () => {
    const context = forward('later-append');
    seedFirstPage(context);
    const store = createStore({ context });
    query.mockResolvedValueOnce(laterPage);
    expect(dataSelectors.hasLaterMessages(store.getState())).toBe(true);

    await store.getState().loadLaterMessages();

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ cursor, direction: 'forward' }));
    expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(store.getState().isLoadingLaterMessages).toBe(false);
    expect(store.getState().laterMessagesError).toBeUndefined();
    expect(dataSelectors.hasLaterMessages(store.getState())).toBe(false);
  });

  it('keeps a failed page as state and only retries on explicit request', async () => {
    const context = forward('later-fail');
    seedFirstPage(context);
    const store = createStore({ context });
    const failure = new Error('network down');
    query.mockRejectedValueOnce(failure).mockResolvedValueOnce(laterPage);

    await expect(store.getState().loadLaterMessages()).resolves.toBeUndefined();
    expect(store.getState().isLoadingLaterMessages).toBe(false);
    expect(store.getState().laterMessagesError).toBe(failure);

    await store.getState().loadLaterMessages();
    expect(query).toHaveBeenCalledTimes(1);

    await store.getState().loadLaterMessages({ retry: true });
    expect(query).toHaveBeenCalledTimes(2);
    expect(store.getState().laterMessagesError).toBeUndefined();
    expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('clears the loading state and the failure on conversation switch', () => {
    expect(createEphemeralResetState()).toMatchObject({
      isLoadingLaterMessages: false,
      laterMessagesError: undefined,
    });
  });
});
