import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { messageService } from '@/services/message';
import { clearMessageListClientCacheState } from '@/services/message/cache';
import { conversationMessagesKey } from '@/services/message/replica';
import { primeForwardMessagePage } from '@/services/message/roundCursorPage';
import { useChatStore } from '@/store/chat';
import { messageStateSelectors } from '@/store/chat/selectors';

import { resetTranscripts, rowsOf, syncMessages } from './testUtils';

vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => ({
    flatList: [...messages].sort((a, b) => a.createdAt - b.createdAt),
    messageMap: Object.fromEntries(messages.map((m) => [m.id, m])),
  }),
}));

vi.mock('@/services/message', () => {
  const getMessages = vi.fn();
  return {
    messageService: {
      getEarlierMessages: vi.fn(),
      getMessageListPage: vi.fn((params) => getMessages(params)),
      getMessages,
    },
  };
});

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { message: { getMessagesByCursor: { query: vi.fn() } } },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => undefined,
  useActiveWorkspaceId: () => undefined,
}));

const fired = vi.hoisted(() => new Set<string>());

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn((key, fetcher, options) => {
    const id = JSON.stringify(key);
    if (key && !fired.has(id)) {
      fired.add(id);
      fetcher?.().then((data: unknown) => options?.onSuccess?.(data));
    }
    return { data: undefined, isValidating: true, mutate: vi.fn() };
  }),
}));

const query = vi.mocked(lambdaClient.message.getMessagesByCursor.query);

const row = (id: string, createdAt: number) =>
  ({ content: id, createdAt, id, role: 'user' }) as UIChatMessage;

const cursorAt = (id: string) => ({ createdAt: '2024-01-01T00:00:00.000Z', id });

const forward = (shareId: string): ConversationContext => ({
  agentId: 'share-agent',
  messageReadMode: 'forward',
  topicId: `topic-${shareId}`,
  topicShareId: shareId,
});

const forwardPage = (ids: string[], next: string | null) => ({
  direction: 'forward' as const,
  hasMore: next !== null,
  messages: ids.map((id, i) => row(id, i)),
  nextCursor: next ? cursorAt(next) : null,
});

describe('message transcript in forward read mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fired.clear();
    clearMessageListClientCacheState();
    resetTranscripts();
  });

  it('reads the head forward from the first round with the shared first-page size', async () => {
    const context = forward('share-head');
    query.mockResolvedValueOnce(forwardPage(['u1', 'a1'], 'a1'));

    syncMessages(context);

    await waitFor(() => expect(rowsOf(context)?.map((m) => m.id)).toEqual(['u1', 'a1']));
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        countBudget: 200,
        cursor: null,
        direction: 'forward',
        roundLimit: 3,
        topicShareId: 'share-head',
      }),
    );
    expect(messageService.getMessageListPage).not.toHaveBeenCalled();
    expect(messageStateSelectors.hasLaterMessages(context)(useChatStore.getState())).toBe(true);
  });

  it('takes the first page the document embedded instead of asking again', async () => {
    const context = forward('share-primed');
    primeForwardMessagePage(context, {
      messages: [row('u1', 0), row('a1', 1)],
      newerCursor: cursorAt('a1'),
    });

    syncMessages(context);

    await waitFor(() => expect(rowsOf(context)?.map((m) => m.id)).toEqual(['u1', 'a1']));
    expect(query).not.toHaveBeenCalled();
  });

  it('appends the next rounds after the loaded ones until the topic ends', async () => {
    const context = forward('share-later');
    query.mockResolvedValueOnce(forwardPage(['u1', 'a1'], 'a1'));
    syncMessages(context);
    await waitFor(() => expect(rowsOf(context)).toHaveLength(2));
    query.mockResolvedValueOnce({
      ...forwardPage([], null),
      messages: [row('u2', 2), row('a2', 3)],
    });

    const result = await useChatStore.getState().loadLaterMessages(context);

    expect(result).toEqual({ error: undefined, started: true });
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: cursorAt('a1'), direction: 'forward' }),
    );
    expect(rowsOf(context)?.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(messageStateSelectors.hasLaterMessages(context)(useChatStore.getState())).toBe(false);
    await expect(useChatStore.getState().loadLaterMessages(context)).resolves.toEqual({
      started: false,
    });
  });

  it('resolves a failed later page with its error and keeps the loaded rows', async () => {
    const context = forward('share-fail');
    query.mockResolvedValueOnce(forwardPage(['u1', 'a1'], 'a1'));
    syncMessages(context);
    await waitFor(() => expect(rowsOf(context)).toHaveLength(2));
    const failure = new Error('network down');
    query.mockRejectedValueOnce(failure);

    const result = await useChatStore.getState().loadLaterMessages(context);

    expect(result).toEqual({ error: failure, started: true });
    expect(rowsOf(context)?.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('never pages earlier history of a forward transcript', async () => {
    const context = forward('share-no-earlier');
    query.mockResolvedValueOnce(forwardPage(['u1', 'a1'], 'a1'));
    syncMessages(context);
    await waitFor(() => expect(rowsOf(context)).toHaveLength(2));

    const result = await useChatStore.getState().loadEarlierMessages(context);

    expect(result).toEqual({ started: false });
    expect(query).toHaveBeenCalledTimes(1);
    expect(messageService.getEarlierMessages).not.toHaveBeenCalled();
  });

  it('keeps a forward transcript in memory, apart from the newest-first one', () => {
    const owned = { agentId: 'a', topicId: 't' };
    const ownedForward = { ...owned, messageReadMode: 'forward' as const };

    expect(conversationMessagesKey(owned)).toMatch(/^p:/);
    expect(conversationMessagesKey(ownedForward)).toMatch(/^m:/);
    expect(conversationMessagesKey(forward('s'))).not.toBe(
      conversationMessagesKey({ ...forward('s'), messageReadMode: undefined }),
    );
  });

  it('does not page later rounds of a newest-first transcript', async () => {
    const context = { agentId: 'owned-agent', topicId: 'owned-topic' };

    await expect(useChatStore.getState().loadLaterMessages(context)).resolves.toEqual({
      started: false,
    });
    expect(messageStateSelectors.hasLaterMessages(context)(useChatStore.getState())).toBe(false);
  });
});
