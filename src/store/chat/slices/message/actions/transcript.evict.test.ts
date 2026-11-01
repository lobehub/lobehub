import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, readReplicaStoredKeys } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { messageListKey } from '@/services/message/cache';
import { conversationMessagesKey, conversationMessagesResource } from '@/services/message/replica';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { getMessageTranscript } from '@/store/chat/slices/message/transcript';
import { evictMessageCache } from '@/store/chat/utils/evictMessageCache';

import { resetTranscripts, rowsOf } from './testUtils';

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual: Record<string, any> = await importOriginal();
  return { ...actual, mutate: vi.fn(actual.mutate) };
});

vi.mock('@/services/topic', async (importOriginal) => {
  const actual: Record<string, any> = await importOriginal();
  return {
    ...actual,
    topicService: { ...actual.topicService, removeTopic: vi.fn().mockResolvedValue(undefined) },
  };
});

// Fresh ids per test: the replica engine keeps per-key removal state for the
// session, which a real reload (unlike `reload` here) starts over.
let run = 0;
let topicA: ConversationContext;
let topicB: ConversationContext;
let otherAgent: ConversationContext;

const row = (id: string) =>
  ({ content: id, createdAt: 1, id, role: 'user', updatedAt: 1 }) as UIChatMessage;

/** The transcript row the replica stored for a conversation (`undefined` = none). */
const storedRow = (context: ConversationContext) =>
  conversationMessagesResource.storage!.get({
    queryKey: conversationMessagesKey(context),
    scope: cacheScope.get(),
  });

/** Persist a settled transcript, as a finished conversation leaves it. */
const persist = async (context: ConversationContext) => {
  useChatStore.getState().replaceMessages([row(`${context.topicId}-msg`)], { context });
  await waitFor(async () => expect(await storedRow(context)).toBeDefined());
};

/** A later session: memory starts empty, only the persisted rows remain. */
const reload = () => resetTranscripts();

describe('transcript eviction', () => {
  beforeEach(async () => {
    run += 1;
    topicA = { agentId: `evict-agent-${run}`, topicId: `evict-topic-a-${run}` };
    topicB = { agentId: `evict-agent-${run}`, topicId: `evict-topic-b-${run}` };
    otherAgent = { agentId: `evict-other-agent-${run}`, topicId: `evict-topic-c-${run}` };
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    resetTranscripts();
    await useChatStore.getState().evictConversationMessages();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops a deleted topic from memory and from the replica storage', async () => {
    await persist(topicA);
    await persist(topicB);

    await act(() => evictMessageCache((ctx) => ctx.topicId === topicA.topicId));

    expect(rowsOf(topicA)).toBeUndefined();
    await waitFor(async () => expect(await storedRow(topicA)).toBeUndefined());
    expect(await storedRow(topicB)).toBeDefined();
    expect(rowsOf(topicB)).toBeDefined();
  });

  it('forgets unconfirmed client rows of an evicted conversation', async () => {
    // A send that never reached the server, e.g. its create failed.
    useChatStore
      .getState()
      .internal_dispatchMessage(
        { id: 'tmp_unsent', type: 'createMessage', value: row('tmp_unsent') as any },
        { conversationContext: topicA },
        { creationOrigin: 'client' },
      );
    const transcript = getMessageTranscript(useChatStore.setState, useChatStore.getState);
    expect(transcript.debugUnconfirmedClientIds()).toContain('tmp_unsent');

    await act(() => evictMessageCache((ctx) => ctx.topicId === topicA.topicId));

    expect(transcript.debugUnconfirmedClientIds()).not.toContain('tmp_unsent');
  });

  it('reaches rows only an earlier session persisted, so they never hydrate again', async () => {
    await persist(topicA);
    await persist(otherAgent);
    reload();

    await act(() => evictMessageCache((ctx) => ctx.agentId === topicA.agentId));

    await waitFor(async () => expect(await storedRow(topicA)).toBeUndefined());
    expect(await readReplicaStoredKeys(conversationMessagesResource)).toEqual([
      conversationMessagesKey(otherAgent),
    ]);
    expect(await useChatStore.getState().preHydrateMessages(topicA)).toBe(false);
    expect(rowsOf(topicA)).toBeUndefined();
    expect(await useChatStore.getState().preHydrateMessages(otherAgent)).toBe(true);
    expect(rowsOf(otherAgent)).toEqual([row(`${otherAgent.topicId}-msg`)]);
  });

  it('wipes every persisted transcript without a predicate', async () => {
    await persist(topicA);
    await persist(otherAgent);
    reload();

    await act(() => evictMessageCache());

    expect(await storedRow(topicA)).toBeUndefined();
    expect(await storedRow(otherAgent)).toBeUndefined();
    expect(await readReplicaStoredKeys(conversationMessagesResource)).toEqual([]);
  });

  it('evicts the transcript of a topic removed from the chat store', async () => {
    await persist(topicA);
    await persist(topicB);
    reload();
    useChatStore.setState({
      activeAgentId: topicA.agentId,
      activeTopicId: undefined,
      refreshTopic: vi.fn().mockResolvedValue(undefined),
    });

    await act(() => useChatStore.getState().removeTopic(topicA.topicId!));

    expect(topicService.removeTopic).toHaveBeenCalledWith(topicA.topicId, undefined);
    await waitFor(async () => expect(await storedRow(topicA)).toBeUndefined());
    expect(await storedRow(topicB)).toBeDefined();
  });

  it('purges the legacy SWR `message:list` rows of deleted conversations too', async () => {
    vi.mocked(mutate).mockClear();

    await act(() => evictMessageCache((ctx) => ctx.topicId === topicA.topicId));

    const [filter, data, options] = vi.mocked(mutate).mock.calls[0];
    expect(typeof filter).toBe('function');
    expect(data).toBeUndefined();
    expect(options).toEqual({ revalidate: false });
    const matches = filter as (key: unknown) => boolean;
    expect(matches(messageListKey(topicA))).toBe(true);
    expect(matches(messageListKey({ ...topicA, threadId: 'thd-1' }))).toBe(true);
    expect(matches(messageListKey(topicB))).toBe(false);
  });

  it('purges every legacy SWR `message:list` row without a predicate', async () => {
    vi.mocked(mutate).mockClear();

    await act(() => evictMessageCache());

    const matches = vi.mocked(mutate).mock.calls[0][0] as (key: unknown) => boolean;
    expect(matches(messageListKey(topicA))).toBe(true);
    expect(matches(messageListKey(otherAgent))).toBe(true);
    expect(matches(['topic:list', 'x', {}])).toBe(false);
  });
});
