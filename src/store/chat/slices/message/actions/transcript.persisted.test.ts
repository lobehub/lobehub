import { type UIChatMessage } from '@lobechat/types';
import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { clearMessageListClientCacheState } from '@/services/message/cache';
import { useChatStore } from '@/store/chat';
import { getMessageTranscript } from '@/store/chat/slices/message/transcript';

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

vi.mock('@/services/topic', () => ({ topicService: { getTopicDetail: vi.fn() } }));

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

const context = { agentId: 'test-session', threadId: null, topicId: 'test-topic' };

const previousReply: UIChatMessage = {
  id: 'previous-reply',
  content: 'Previous reply',
  role: 'assistant',
  createdAt: 1000,
  updatedAt: 1000,
};
const created: UIChatMessage = {
  id: 'msg_client',
  content: '',
  role: 'assistant',
  createdAt: 2000,
  updatedAt: 2000,
};

/** A runtime row created on the client and written quietly (no snapshot back). */
const createClientRow = () =>
  useChatStore
    .getState()
    .internal_dispatchMessage(
      { id: created.id, type: 'createMessage', value: created as any },
      { conversationContext: context },
      { creationOrigin: 'client' },
    );

describe('quietly persisted client rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMessageListClientCacheState();
    resetTranscripts();
  });

  it('drops a persisted row omitted by a read issued after the acknowledgement', async () => {
    seedRows(context, [previousReply]);
    createClientRow();
    useChatStore.getState().internal_confirmClientMessages([created.id]);

    const transcript = getMessageTranscript(useChatStore.setState, useChatStore.getState);
    expect(transcript.debugUnconfirmedClientIds()).not.toContain(created.id);

    // Deleted on another device before any head read returned it.
    vi.mocked(messageService.getMessages).mockResolvedValue([previousReply]);
    syncMessages(context);

    await waitFor(() =>
      expect(rowsOf(context)?.map((message) => message.id)).toEqual([previousReply.id]),
    );
  });

  it('keeps a persisted row for a read issued before the acknowledgement', async () => {
    let resolveFetch!: (messages: UIChatMessage[]) => void;
    vi.mocked(messageService.getMessages).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }) as Promise<UIChatMessage[]>,
    );
    seedRows(context, [previousReply]);
    syncMessages(context);
    await waitFor(() => expect(messageService.getMessages).toHaveBeenCalledTimes(1));

    createClientRow();
    useChatStore.getState().internal_confirmClientMessages([created.id]);

    // That read's snapshot predates the write.
    await act(async () => {
      resolveFetch([{ ...previousReply, content: 'Previous reply (fetched)', updatedAt: 1500 }]);
    });

    await waitFor(() => expect(rowsOf(context)?.[0].content).toBe('Previous reply (fetched)'));
    expect(rowsOf(context)?.map((message) => message.id)).toEqual([previousReply.id, created.id]);
  });
});
