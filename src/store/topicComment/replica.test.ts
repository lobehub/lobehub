/**
 * @vitest-environment happy-dom
 *
 * `topicComment` is a `@lobechat/replica`-backed store. The root feed, the
 * reply feed, the per-topic counts and one comment by id each paint their
 * persisted row before the network answers, are confirmed and persisted by the
 * response, page further through the engine, and are re-partitioned when the
 * cache scope changes — instead of the hand-written SWR/infinite caches the
 * four resources replaced.
 */
import { randomUUID } from 'node:crypto';

import type { TopicCommentItem, TopicCommentThread } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { topicCommentService } from '@/services/topicComment';

import { initialState } from './initialState';
import {
  topicCommentDetailResource,
  topicCommentReplyResource,
  topicCommentThreadResource,
  topicCommentThreadsKey,
} from './projection';
import { useTopicCommentStore } from './store';

const THREAD_PARAMS = { pageSize: 30, topicId: 'topic-1' };
const THREAD_VIEW_KEY = topicCommentThreadsKey(THREAD_PARAMS);
const THREAD_STORAGE_KEY = topicCommentThreadResource.storageKey(THREAD_PARAMS);

const comment = (id: string, overrides: Partial<TopicCommentItem> = {}): TopicCommentItem => ({
  anchorPreview: null,
  author: {
    avatar: null,
    fullName: 'Current User',
    id: 'user-1',
    status: 'active',
    username: 'current-user',
  },
  authorUserId: 'user-1',
  canDelete: true,
  canEdit: true,
  canRestore: false,
  clientId: `client-${id}`,
  content: id,
  createdAt: new Date('2026-07-20T00:00:00.000Z'),
  deletedAt: null,
  editorData: null,
  id,
  messageId: null,
  moderatedAt: null,
  moderationExpiresAt: null,
  moderationIsOwn: false,
  parentCommentId: null,
  topicId: 'topic-1',
  updatedAt: new Date('2026-07-20T00:00:00.000Z'),
  workspaceId: 'workspace-1',
  ...overrides,
});

const thread = (id: string, replyCount = 0): TopicCommentThread => ({
  replyCount,
  root: comment(id),
});

const ids = (feed?: { items: TopicCommentThread[] }) => feed?.items.map(({ root }) => root.id);

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

describe('topicComment replicas', () => {
  const scopes = new Set<string>();
  let scope = '';
  let listThreadsSpy: ReturnType<typeof vi.spyOn>;
  let listRepliesSpy: ReturnType<typeof vi.spyOn>;

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`topic-user-${randomUUID()}:personal`);
    listThreadsSpy = vi.spyOn(topicCommentService, 'listThreads');
    listRepliesSpy = vi.spyOn(topicCommentService, 'listReplies');
    act(() => useTopicCommentStore.setState(initialState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) => [
        topicCommentThreadResource.storage!.remove({ queryKey: THREAD_STORAGE_KEY, scope: value }),
        topicCommentReplyResource.storage!.remove({ queryKey: 'root-1', scope: value }),
        topicCommentDetailResource.storage!.remove({ queryKey: 'comment-1', scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted root feed before the network answers', async () => {
    const cached = {
      currentPage: 0,
      hasMore: true,
      items: [thread('cached-1', 2)],
      nextCursor: 'c1',
      total: 5,
    };
    await topicCommentThreadResource.storage!.set(
      { queryKey: THREAD_STORAGE_KEY, scope },
      { data: cached, updatedAt: 1 },
    );
    listThreadsSpy.mockImplementation(pending);

    const hook = renderHook(
      () => ({
        feed: useTopicCommentStore((s) => s.threadFeedMap[THREAD_VIEW_KEY]),
        sync: useTopicCommentStore((s) => s.useFetchTopicCommentThreads)(THREAD_PARAMS),
      }),
      { wrapper },
    );

    await waitFor(() =>
      expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual([
        'cached-1',
      ]),
    );
    expect(hook.result.current.sync.isHydrated).toBe(true);
    expect(hook.result.current.sync.isValidating).toBe(true);
  });

  it('replaces the head page with the server response and persists it', async () => {
    listThreadsSpy.mockResolvedValue({
      items: [thread('a'), thread('b')],
      nextCursor: 'next',
    });

    renderHook(() => useTopicCommentStore((s) => s.useFetchTopicCommentThreads)(THREAD_PARAMS), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual([
        'a',
        'b',
      ]),
    );
    expect(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY]).toMatchObject({
      currentPage: 0,
      hasMore: true,
    });

    await waitFor(async () => {
      const row = await topicCommentThreadResource.storage!.get({
        queryKey: THREAD_STORAGE_KEY,
        scope,
      });
      expect(ids(row?.data as { items: TopicCommentThread[] })).toEqual(['a', 'b']);
    });
  });

  it('appends the next page through the engine cursor', async () => {
    listThreadsSpy
      .mockResolvedValueOnce({ items: [thread('a')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [thread('b')], nextCursor: null });

    renderHook(() => useTopicCommentStore((s) => s.useFetchTopicCommentThreads)(THREAD_PARAMS), {
      wrapper,
    });
    await waitFor(() =>
      expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual(['a']),
    );

    await act(async () => {
      await useTopicCommentStore.getState().loadMoreTopicCommentThreads(THREAD_PARAMS);
    });

    expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual(['a', 'b']);
    expect(listThreadsSpy).toHaveBeenLastCalledWith({
      cursor: 'c1',
      limit: 30,
      messageId: undefined,
      topicId: 'topic-1',
    });
  });

  it('warms the topic feed and its reply threads into the views and persists them', async () => {
    listThreadsSpy.mockResolvedValue({ items: [thread('root-1', 2)], nextCursor: null });
    listRepliesSpy.mockResolvedValue({
      items: [comment('reply-1', { parentCommentId: 'root-1' })],
      nextCursor: null,
      total: 1,
    });

    await act(async () => {
      await useTopicCommentStore.getState().prefetchTopicComments('topic-1');
    });

    expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual(['root-1']);
    expect(useTopicCommentStore.getState().replyFeedMap['root-1']?.items).toHaveLength(1);
    expect(listRepliesSpy).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 30,
      rootCommentId: 'root-1',
    });

    await waitFor(async () => {
      const threadRow = await topicCommentThreadResource.storage!.get({
        queryKey: THREAD_STORAGE_KEY,
        scope,
      });
      const replyRow = await topicCommentReplyResource.storage!.get({
        queryKey: 'root-1',
        scope,
      });
      expect(ids(threadRow?.data as { items: TopicCommentThread[] })).toEqual(['root-1']);
      expect((replyRow?.data as { items: TopicCommentItem[] }).items).toHaveLength(1);
    });
  });

  it('drops the previous identity feed when the cache scope changes', async () => {
    listThreadsSpy.mockResolvedValue({ items: [thread('a')], nextCursor: null });

    const hook = renderHook(
      () => useTopicCommentStore((s) => s.useFetchTopicCommentThreads)(THREAD_PARAMS),
      { wrapper },
    );
    await waitFor(() =>
      expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual(['a']),
    );

    useScope(`topic-user-${randomUUID()}:personal`);
    listThreadsSpy.mockImplementation(pending);
    hook.rerender();

    await waitFor(() =>
      expect(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY]).toBeUndefined(),
    );
  });

  it('drops the loaded tail when the feed is revalidated for an event', async () => {
    listThreadsSpy
      .mockResolvedValueOnce({ items: [thread('a')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [thread('b')], nextCursor: null })
      .mockResolvedValueOnce({ items: [thread('a')], nextCursor: 'c1' });

    renderHook(() => useTopicCommentStore((s) => s.useFetchTopicCommentThreads)(THREAD_PARAMS), {
      wrapper,
    });
    await waitFor(() =>
      expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual(['a']),
    );

    await act(async () => {
      await useTopicCommentStore.getState().loadMoreTopicCommentThreads(THREAD_PARAMS);
    });
    expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual(['a', 'b']);
    expect(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY]?.currentPage).toBe(1);

    await act(async () => {
      await useTopicCommentStore.getState().revalidateTopicCommentThreads(THREAD_PARAMS);
    });

    // A head-only refresh would keep the stale tail: the view collapses to the
    // refreshed head page instead.
    await waitFor(() =>
      expect(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY]?.currentPage).toBe(0),
    );
    expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual(['a']);
  });

  it('does not paint a warmup that lands after the cache scope changed', async () => {
    let resolveThreads: ((page: unknown) => void) | undefined;
    listThreadsSpy
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveThreads = resolve;
          }),
      )
      .mockImplementation(pending);

    const prefetch = useTopicCommentStore.getState().prefetchTopicComments('topic-1');
    await waitFor(() => expect(resolveThreads).toBeDefined());

    // The identity changes while the warmup is in flight, and a consumer mounts
    // in the new partition — that partition's replica slot is now the active one.
    useScope(`topic-user-${randomUUID()}:personal`);
    renderHook(() => useTopicCommentStore((s) => s.useFetchTopicCommentThreads)(THREAD_PARAMS), {
      wrapper,
    });

    await act(async () => {
      resolveThreads!({ items: [thread('late')], nextCursor: null });
      await prefetch;
    });

    expect(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY]).toBeUndefined();
  });

  it('does not paint a warmup reply that lands after the cache scope changed', async () => {
    // The warmup passes the scope it captured to every replacement, not only the
    // root feed: the reply fetched for a root under one identity must be rejected
    // when the identity changes before it lands, so it can neither paint nor
    // persist into the new partition.
    let resolveReplies: ((page: unknown) => void) | undefined;
    listThreadsSpy.mockResolvedValue({ items: [thread('root-1', 1)], nextCursor: null });
    listRepliesSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReplies = resolve;
        }),
    );

    const prefetch = useTopicCommentStore.getState().prefetchTopicComments('topic-1');
    await waitFor(() => expect(resolveReplies).toBeDefined());

    // The root feed was already replaced under the identity it was fetched for,
    // and the reply prefetch it triggered is the request now in flight.
    expect(ids(useTopicCommentStore.getState().threadFeedMap[THREAD_VIEW_KEY])).toEqual(['root-1']);

    const nextScope = `topic-user-${randomUUID()}:personal`;
    useScope(nextScope);

    await act(async () => {
      resolveReplies!({
        items: [comment('reply-1', { parentCommentId: 'root-1' })],
        nextCursor: null,
        total: 1,
      });
      await prefetch;
    });

    expect(useTopicCommentStore.getState().replyFeedMap['root-1']).toBeUndefined();
    await waitFor(async () => {
      const row = await topicCommentReplyResource.storage!.get({
        queryKey: 'root-1',
        scope: nextScope,
      });
      expect(row).toBeUndefined();
    });
  });

  it('keeps one comment by id in the detail view and drops it from view and storage', async () => {
    act(() => useTopicCommentStore.getState().upsertTopicCommentDetail(comment('comment-1')));

    expect(useTopicCommentStore.getState().commentDetailMap['comment-1']?.id).toBe('comment-1');
    await waitFor(async () => {
      const row = await topicCommentDetailResource.storage!.get({
        queryKey: 'comment-1',
        scope,
      });
      expect(row?.data).toMatchObject({ id: 'comment-1' });
    });

    act(() => useTopicCommentStore.getState().removeTopicCommentDetail('comment-1'));

    expect(useTopicCommentStore.getState().commentDetailMap['comment-1']).toBeUndefined();
    await waitFor(async () => {
      const row = await topicCommentDetailResource.storage!.get({
        queryKey: 'comment-1',
        scope,
      });
      expect(row).toBeUndefined();
    });
  });
});
