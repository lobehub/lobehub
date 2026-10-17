import type { UIChatMessage } from '@lobechat/types';
import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { messageService } from '@/services/message';
import { clearMessageListClientCacheState, runMessageListQuery } from '@/services/message/cache';
import {
  conversationMessagesKey,
  conversationMessagesResource,
  transcriptOf,
} from '@/services/message/replica';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { resetTranscripts, rowsOf, seedRows, syncMessages } from './testUtils';

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

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => undefined,
  useActiveWorkspaceId: () => undefined,
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn((key, fetcher, options) => {
    if (key) fetcher?.().then((data: unknown) => options?.onSuccess?.(data));
    return { data: undefined, isValidating: true, mutate: vi.fn() };
  }),
}));

describe('message transcript paging and persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    clearMessageListClientCacheState();
    resetTranscripts();
  });

  it('keeps paged history when the head revalidates', async () => {
    const context = { agentId: 'review-agent', topicId: 'review-topic', threadId: null };
    const old = { id: 'old', role: 'user', content: 'older', createdAt: 1 } as UIChatMessage;
    const head = { id: 'head', role: 'user', content: 'newest', createdAt: 2 } as UIChatMessage;
    const cursor = { id: 'head', createdAt: '1970-01-01T00:00:00.002Z' };
    await runMessageListQuery(context, async () => ({ messages: [head], olderCursor: cursor }));
    useChatStore.getState().replaceMessages([head], { context });
    vi.mocked(messageService.getEarlierMessages).mockResolvedValueOnce({
      messages: [old],
      olderCursor: null,
    });
    await useChatStore.getState().loadEarlierMessages(context);
    vi.mocked(messageService.getMessageListPage).mockResolvedValueOnce({
      messages: [head],
      olderCursor: cursor,
    });

    syncMessages(context);

    await waitFor(() => expect(messageService.getMessageListPage).toHaveBeenCalled());
    await waitFor(() => expect(rowsOf(context)).toEqual([old, head]));
  });

  it('resets paging after an unpaged replacement but keeps it for an unchanged one', () => {
    const context = { agentId: 'replace-agent', topicId: 'replace-topic', threadId: null };
    const key = conversationMessagesKey(context);
    const rows = ['older', 'head'].map((id, i) => ({
      id,
      role: 'user',
      content: id,
      createdAt: i,
    })) as UIChatMessage[];
    const paging = {
      currentPage: 2,
      pageSize: 1,
      hasMore: true,
      anchorId: 'head',
      nextCursor: { id: 'older', createdAt: 'old' },
      pages: [{ count: 1 }, { count: 1 }],
    };
    seedRows(context, rows);
    useChatStore.setState({ messagePagingMap: { [key]: paging as any } });

    useChatStore.getState().replaceMessages([...rows], { context });
    expect(useChatStore.getState().messagePagingMap[key]).toEqual(paging);

    useChatStore.getState().replaceMessages([rows[1]], { context });
    expect(useChatStore.getState().messagePagingMap[key]).toEqual({
      currentPage: 0,
      pageSize: 1,
      hasMore: true,
    });
  });

  it('keeps streamed writes in memory and persists once the run settles', async () => {
    let running = true;
    vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockImplementation(
      () => () => running,
    );
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    const storageSet = vi
      .spyOn(conversationMessagesResource.storage!, 'set')
      .mockResolvedValue(undefined);
    const context = { agentId: 'agent-persist', threadId: null, topicId: 'topic-persist' };

    for (const id of ['m1', 'm2']) {
      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id, type: 'createMessage', value: { content: id, role: 'assistant' } as any },
          { conversationContext: context },
        );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The engine also tracks its stored keys in an index row.
    const transcriptWrites = () =>
      storageSet.mock.calls.filter(([, row]) => Array.isArray((row.data as any)?.items));
    expect(transcriptWrites()).toHaveLength(0);

    running = false;
    useChatStore.getState().internal_settleTranscript(context);

    await waitFor(() => expect(transcriptWrites()).toHaveLength(1));
    const [[, row]] = transcriptWrites();
    expect((row.data as any).items.map((m: UIChatMessage) => m.id)).toEqual(['m1', 'm2']);
  });

  it('persists a settled write to a conversation no view shows', async () => {
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    const storageSet = vi
      .spyOn(conversationMessagesResource.storage!, 'set')
      .mockResolvedValue(undefined);
    const context = { agentId: 'agent-bg', threadId: null, topicId: 'topic-bg' };
    const rows = [{ id: 'bg-1', role: 'user', content: 'hi', createdAt: 1 }] as UIChatMessage[];

    useChatStore.getState().replaceMessages(rows, { context });

    await waitFor(() =>
      expect(
        storageSet.mock.calls.some(([, row]) => (row.data as any)?.items?.[0]?.id === 'bg-1'),
      ).toBe(true),
    );
  });

  it('pre-hydrates a stored transcript but never replaces rows already in memory', async () => {
    const stored = [
      { id: 'stored', role: 'user', content: 'stored', createdAt: 1 },
    ] as UIChatMessage[];
    vi.spyOn(conversationMessagesResource.storage!, 'get').mockImplementation(async (key) =>
      key.queryKey === REPLICA_INDEX_KEY ? undefined : { data: transcriptOf(stored), updatedAt: 1 },
    );
    const cold = { agentId: 'agent-pre', scope: 'main' as const, topicId: 'topic-cold' };
    const live = { agentId: 'agent-pre', scope: 'main' as const, topicId: 'topic-live' };
    const liveRows = [
      { id: 'live', role: 'user', content: 'live', createdAt: 2 },
    ] as UIChatMessage[];
    seedRows(live, liveRows);

    await useChatStore.getState().preHydrateMessages(cold);
    await useChatStore.getState().preHydrateMessages(live);

    expect(rowsOf(cold)).toEqual(stored);
    expect(rowsOf(live)).toBe(liveRows);
  });
});
