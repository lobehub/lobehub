import type { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { clearMessageListClientCacheState } from '@/services/message/cache';

import { createStore } from '../../index';

vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => ({
    flatList: [...messages].sort((a, b) => a.createdAt - b.createdAt),
    messageMap: Object.fromEntries(messages.map((m) => [m.id, m])),
  }),
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getCompressedGroupMembers: vi.fn(),
    getEarlierMessages: vi.fn(),
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => undefined,
  useActiveWorkspaceId: () => undefined,
}));

const getMembers = vi.mocked(messageService.getCompressedGroupMembers);

const row = (id: string, role: string, createdAt: number) =>
  ({ content: id, createdAt, id, role, updatedAt: createdAt }) as UIChatMessage;

/**
 * The window after a long topic was compressed: the triggering question, and
 * the group (created mid-turn, so it sorts after the question) whose node
 * carries only its newest members.
 */
const windowRows = (topicId: string) => [
  row('u9', 'user', 1000),
  {
    ...row('group', 'compressedGroup', 1500),
    compressedMessages: [row('u8', 'user', 800), row('a8', 'assistant', 900)],
    compressedOmittedIds: ['u1', 'a1', 'u2', 'a2'],
    topicId,
  } as UIChatMessage,
];

/** The transcript itself has no older page left. */
const noOlderTranscriptPage = () =>
  vi.mocked(messageService.getEarlierMessages).mockResolvedValue({
    messages: [],
    olderCursor: null,
  });

describe('loadEarlierMessages through a compression group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMessageListClientCacheState();
  });

  it('pages the group members older than its node until the group start', async () => {
    const context = { agentId: 'agent-compressed', topicId: 'topic-compressed-1' };
    const store = createStore({ context });
    store.getState().replaceMessages(windowRows(context.topicId));
    noOlderTranscriptPage();

    getMembers.mockResolvedValueOnce({
      messages: [row('u2', 'user', 200), row('a2', 'assistant', 300)],
      nextUntilId: 'a1',
    });
    await store.getState().loadEarlierMessages();

    expect(getMembers).toHaveBeenLastCalledWith({
      groupId: 'group',
      topicId: 'topic-compressed-1',
      untilId: 'a2',
    });

    getMembers.mockResolvedValueOnce({
      messages: [row('u1', 'user', 0), row('a1', 'assistant', 100)],
    });
    await store.getState().loadEarlierMessages();

    expect(getMembers).toHaveBeenLastCalledWith(expect.objectContaining({ untilId: 'a1' }));
    expect(
      store.getState().compressedHistoryPages.group.messages.map((message) => message.id),
    ).toEqual(['u1', 'a1', 'u2', 'a2']);

    // Every member is loaded: further gestures fetch nothing.
    await store.getState().loadEarlierMessages();
    expect(getMembers).toHaveBeenCalledTimes(2);
    expect(store.getState().isLoadingEarlierMessages).toBe(false);
  });

  it('keeps a failed page for the inline Retry instead of refetching on every gesture', async () => {
    const context = { agentId: 'agent-compressed', topicId: 'topic-compressed-2' };
    const store = createStore({ context });
    store.getState().replaceMessages(windowRows(context.topicId));
    noOlderTranscriptPage();

    getMembers.mockRejectedValueOnce(new Error('network'));
    await store.getState().loadEarlierMessages();
    expect(store.getState().earlierMessagesError).toBeInstanceOf(Error);

    await store.getState().loadEarlierMessages();
    expect(getMembers).toHaveBeenCalledTimes(1);

    getMembers.mockResolvedValueOnce({ messages: [row('u2', 'user', 200)] });
    await store.getState().loadEarlierMessages({ retry: true });

    expect(store.getState().earlierMessagesError).toBeUndefined();
    expect(store.getState().compressedHistoryPages.group.messages).toHaveLength(1);
  });

  it('pages a later group on request, where reaching the top never does', async () => {
    const context = { agentId: 'agent-compressed', topicId: 'topic-compressed-4' };
    const store = createStore({ context });
    const [question, group] = windowRows(context.topicId);
    store.getState().replaceMessages([
      {
        ...row('older', 'compressedGroup', 50),
        compressedMessages: [row('u0', 'user', 10)],
        topicId: context.topicId,
      } as UIChatMessage,
      question,
      group,
    ]);
    noOlderTranscriptPage();

    // The oldest group has nothing left, so scrolling to the top pages nothing.
    await store.getState().loadEarlierMessages();
    expect(getMembers).not.toHaveBeenCalled();

    getMembers.mockResolvedValueOnce({ messages: [row('u2', 'user', 200)] });
    await store.getState().loadCompressedGroupHistory('group');

    expect(getMembers).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'group', untilId: 'a2' }),
    );
    expect(store.getState().compressedHistoryPages.group.messages.map((m) => m.id)).toEqual(['u2']);
  });

  it('keeps a later group failure on that group, apart from the top-of-list retry', async () => {
    const context = { agentId: 'agent-compressed', topicId: 'topic-compressed-6' };
    const store = createStore({ context });
    const [question, group] = windowRows(context.topicId);
    store.getState().replaceMessages([
      {
        ...row('older', 'compressedGroup', 50),
        compressedMessages: [row('u0', 'user', 10)],
        topicId: context.topicId,
      } as UIChatMessage,
      question,
      group,
    ]);
    noOlderTranscriptPage();

    getMembers.mockRejectedValueOnce(new Error('network'));
    await store.getState().loadCompressedGroupHistory('group');

    expect(store.getState().compressedHistoryError).toEqual({
      error: expect.any(Error),
      groupId: 'group',
    });
    // The top of the list has nothing failed to retry.
    expect(store.getState().earlierMessagesError).toBeUndefined();

    // A plain click does not refire; the gap's Retry pages the same group.
    await store.getState().loadCompressedGroupHistory('group');
    expect(getMembers).toHaveBeenCalledTimes(1);

    getMembers.mockResolvedValueOnce({ messages: [row('u2', 'user', 200)] });
    await store.getState().loadCompressedGroupHistory('group', { retry: true });

    expect(getMembers).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupId: 'group', untilId: 'a2' }),
    );
    expect(store.getState().compressedHistoryError).toBeUndefined();
    expect(store.getState().compressedHistoryPages.group.messages.map((m) => m.id)).toEqual(['u2']);
  });

  it('drops a page that a newer request superseded after leaving and reopening the topic', async () => {
    const context = { agentId: 'agent-compressed', topicId: 'topic-compressed-5' };
    const store = createStore({ context });
    store.getState().replaceMessages(windowRows(context.topicId));
    noOlderTranscriptPage();

    let resolveStale!: (page: { messages: UIChatMessage[] }) => void;
    getMembers.mockReturnValueOnce(new Promise((resolve) => (resolveStale = resolve)));
    const stale = store.getState().loadEarlierMessages();
    await vi.waitFor(() => expect(getMembers).toHaveBeenCalledTimes(1));

    // Leave and come back: the reset clears the in-flight flag, so paging starts again.
    store.setState({ isLoadingEarlierMessages: false });
    getMembers.mockResolvedValueOnce({ messages: [row('u2', 'user', 200)], nextUntilId: 'a1' });
    await store.getState().loadEarlierMessages();

    resolveStale({ messages: [row('u2', 'user', 200)] });
    await stale;

    expect(store.getState().compressedHistoryPages.group).toEqual({
      messages: [expect.objectContaining({ id: 'u2' })],
      nextUntilId: 'a1',
    });
  });

  it('does not page a shared view through the owner-only endpoint', async () => {
    const context = {
      agentId: 'agent-compressed',
      topicId: 'topic-compressed-3',
      topicShareId: 'share-1',
    };
    const store = createStore({ context });
    store.getState().replaceMessages(windowRows(context.topicId));
    noOlderTranscriptPage();

    await store.getState().loadEarlierMessages();

    expect(getMembers).not.toHaveBeenCalled();
  });
});
