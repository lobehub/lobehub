/**
 * @vitest-environment happy-dom
 *
 * `documentComment` is a `@lobechat/replica`-backed store. The root feeds, the
 * reply feeds, the comment summary, the anchor list, deep-link details and the
 * like summary paint their persisted row before the network answers and are
 * confirmed (and persisted) by the response — instead of the SWR caches they
 * replaced, which painted a skeleton on every cold start.
 */
import { randomUUID } from 'node:crypto';

import type {
  DocumentCommentItem,
  DocumentCommentThread,
  DocumentLikeSummary,
} from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { documentCommentService } from '@/services/documentComment';
import { documentLikeService } from '@/services/documentLike';

import { documentCommentActions } from './action';
import { initialState } from './initialState';
import {
  documentCommentDetailResource,
  documentCommentReplyResource,
  documentCommentSummaryResource,
  documentCommentThreadResource,
  documentCommentThreadsKey,
  documentLikeSummaryResource,
} from './projection';
import { useDocumentCommentStore } from './store';

const DOCUMENT_ID = 'document-1';
const ANCHORED = { documentId: DOCUMENT_ID, scope: 'anchored' } as const;
const LIST = { documentId: DOCUMENT_ID, scope: 'document' } as const;
const ANCHORED_KEY = documentCommentThreadsKey(ANCHORED);
const LIST_KEY = documentCommentThreadsKey(LIST);

const anchor = { end: 5, quote: 'hello', start: 0 };

const comment = (
  id: string,
  overrides: Partial<DocumentCommentItem> = {},
): DocumentCommentItem => ({
  author: { avatar: null, fullName: 'Lin', id: 'user-1', status: 'active', username: 'lin' },
  authorUserId: 'user-1',
  canDelete: true,
  canEdit: true,
  clientId: `client-${id}`,
  content: id,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  deletedAt: null,
  documentId: DOCUMENT_ID,
  editorData: null,
  id,
  parentCommentId: null,
  replyTo: null,
  replyToCommentId: null,
  selectionAnchor: null,
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  workspaceId: 'workspace-1',
  ...overrides,
});

const thread = (id: string, replyCount = 0, overrides?: Partial<DocumentCommentItem>) =>
  ({ replyCount, root: comment(id, overrides) }) satisfies DocumentCommentThread;

const rootIds = (feed?: { items: DocumentCommentThread[] }) =>
  feed?.items.map(({ root }) => root.id);

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

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

const state = () => useDocumentCommentStore.getState();

describe('documentComment replicas', () => {
  const scopes = new Set<string>();
  let scope = '';

  beforeEach(() => {
    scope = `doc-comment-user-${randomUUID()}:workspace-1`;
    scopes.add(scope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useDocumentCommentStore.setState(initialState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) => [
        documentCommentThreadResource.storage!.remove({
          queryKey: documentCommentThreadResource.storageKey(ANCHORED),
          scope: value,
        }),
        documentCommentThreadResource.storage!.remove({
          queryKey: documentCommentThreadResource.storageKey(LIST),
          scope: value,
        }),
        documentCommentReplyResource.storage!.remove({ queryKey: 'root-1', scope: value }),
        documentCommentSummaryResource.storage!.remove({ queryKey: DOCUMENT_ID, scope: value }),
        documentCommentDetailResource.storage!.remove({ queryKey: 'comment-1', scope: value }),
        documentLikeSummaryResource.storage!.remove({ queryKey: DOCUMENT_ID, scope: value }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
  });

  describe('reads', () => {
    it('paints the persisted thread feed and summary before the network answers', async () => {
      await documentCommentThreadResource.storage!.set(
        { queryKey: documentCommentThreadResource.storageKey(LIST), scope },
        {
          data: { currentPage: 0, hasMore: false, items: [thread('cached-1', 2)], pageSize: 20 },
          updatedAt: 1,
        },
      );
      await documentCommentSummaryResource.storage!.set(
        { queryKey: DOCUMENT_ID, scope },
        { data: { total: 3 }, updatedAt: 1 },
      );
      vi.spyOn(documentCommentService, 'listThreads').mockImplementation(pending);
      vi.spyOn(documentCommentService, 'summary').mockImplementation(pending);

      renderHook(
        () => {
          documentCommentActions.useFetchThreads(LIST);
          documentCommentActions.useFetchSummary(DOCUMENT_ID);
        },
        { wrapper },
      );

      await waitFor(() => expect(rootIds(state().threadFeedMap[LIST_KEY])).toEqual(['cached-1']));
      await waitFor(() => expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 }));
    });

    it('keeps each scope to its own subset and persists the confirmed head page', async () => {
      const listThreads = vi.spyOn(documentCommentService, 'listThreads').mockResolvedValue({
        // A server predating `anchored` answers with a mixed page.
        items: [thread('a', 0, { selectionAnchor: anchor }), thread('b')],
        nextCursor: null,
      });

      renderHook(() => documentCommentActions.useFetchThreads(ANCHORED), { wrapper });

      await waitFor(() => expect(rootIds(state().threadFeedMap[ANCHORED_KEY])).toEqual(['a']));
      expect(listThreads).toHaveBeenCalledWith({
        anchored: true,
        cursor: undefined,
        documentId: DOCUMENT_ID,
        limit: 50,
      });
      await waitFor(async () => {
        const row = await documentCommentThreadResource.storage!.get({
          queryKey: documentCommentThreadResource.storageKey(ANCHORED),
          scope,
        });
        expect(rootIds(row?.data as { items: DocumentCommentThread[] })).toEqual(['a']);
      });
    });

    it('pages a confirmed feed through the engine cursor', async () => {
      const listThreads = vi
        .spyOn(documentCommentService, 'listThreads')
        .mockResolvedValueOnce({ items: [thread('a')], nextCursor: 'c1' })
        .mockResolvedValueOnce({ items: [thread('b')], nextCursor: null });

      renderHook(() => documentCommentActions.useFetchThreads(LIST), { wrapper });
      await waitFor(() => expect(rootIds(state().threadFeedMap[LIST_KEY])).toEqual(['a']));

      await act(() => documentCommentActions.loadMoreThreads(LIST));

      expect(rootIds(state().threadFeedMap[LIST_KEY])).toEqual(['a', 'b']);
      expect(listThreads).toHaveBeenLastCalledWith({
        anchored: false,
        cursor: 'c1',
        documentId: DOCUMENT_ID,
        limit: 20,
      });
    });

    it('drops a persisted deep-link target the server reports gone', async () => {
      await documentCommentDetailResource.storage!.set(
        { queryKey: 'comment-1', scope },
        { data: { ...comment('comment-1'), replyCount: 0 }, updatedAt: 1 },
      );
      vi.spyOn(documentCommentService, 'get').mockRejectedValue({ data: { code: 'NOT_FOUND' } });

      renderHook(() => documentCommentActions.useFetchDetail('comment-1'), { wrapper });

      await waitFor(async () => {
        const row = await documentCommentDetailResource.storage!.get({
          queryKey: 'comment-1',
          scope,
        });
        expect(row).toBeUndefined();
      });
      expect(state().detailMap['comment-1']).toBeUndefined();
    });

    it('re-reads the document feeds, summary and anchors on a comment event', async () => {
      const listThreads = vi
        .spyOn(documentCommentService, 'listThreads')
        .mockResolvedValue({ items: [], nextCursor: null });
      const summary = vi.spyOn(documentCommentService, 'summary').mockResolvedValue({ total: 0 });
      vi.spyOn(documentCommentService, 'listAnchors').mockResolvedValue({ items: [] });

      renderHook(
        () => {
          documentCommentActions.useFetchThreads(LIST);
          documentCommentActions.useFetchSummary(DOCUMENT_ID);
          documentCommentActions.useFetchAnchors(DOCUMENT_ID);
        },
        { wrapper },
      );
      await waitFor(() => expect(state().threadFeedMap[LIST_KEY]).toBeDefined());
      const before = listThreads.mock.calls.length;
      summary.mockResolvedValue({ total: 4 });

      await act(() =>
        documentCommentActions.revalidateForCommentEvent({ documentId: DOCUMENT_ID }),
      );

      await waitFor(() => expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 4 }));
      expect(listThreads.mock.calls.length).toBeGreaterThan(before);
    });
  });

  describe('writes', () => {
    const seed = () =>
      act(() => {
        useDocumentCommentStore.setState({
          ...initialState,
          threadFeedMap: {
            [LIST_KEY]: {
              currentPage: 0,
              hasMore: false,
              items: [thread('root-1', 1)],
              pageSize: 20,
            },
          },
          replyFeedMap: {
            'root-1': {
              currentPage: 0,
              hasMore: false,
              items: [comment('reply-1', { parentCommentId: 'root-1' })],
              pageSize: 20,
              total: 1,
            },
          },
          summaryMap: { [DOCUMENT_ID]: { total: 2 } },
        });
      });

    it('shows a new root at once and settles it on the server row', async () => {
      seed();
      const request = deferred<{ comment: DocumentCommentItem; isDuplicate: boolean }>();
      vi.spyOn(documentCommentService, 'create').mockReturnValue(request.promise as never);
      const optimisticComment = comment('optimistic:new', { clientId: 'new' });

      let done!: Promise<unknown>;
      act(() => {
        done = documentCommentActions.createRootComment({
          input: { clientId: 'new', content: 'new', documentId: DOCUMENT_ID },
          optimisticComment,
        });
      });

      expect(rootIds(state().threadFeedMap[LIST_KEY])).toEqual(['root-1', 'optimistic:new']);
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });

      await act(async () => {
        request.resolve({ comment: comment('root-2', { clientId: 'new' }), isDuplicate: false });
        await done;
      });

      expect(rootIds(state().threadFeedMap[LIST_KEY])).toEqual(['root-1', 'root-2']);
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });
    });

    it('rolls a failed root back out of the feed and the count', async () => {
      seed();
      vi.spyOn(documentCommentService, 'create').mockRejectedValue(new Error('offline'));

      await act(async () => {
        await expect(
          documentCommentActions.createRootComment({
            input: { clientId: 'new', content: 'new', documentId: DOCUMENT_ID },
            optimisticComment: comment('optimistic:new', { clientId: 'new' }),
          }),
        ).rejects.toThrow('offline');
      });

      expect(rootIds(state().threadFeedMap[LIST_KEY])).toEqual(['root-1']);
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 2 });
    });

    it('moves a reply, its root reply count and the summary together, and rolls them back together', async () => {
      seed();
      const create = vi
        .spyOn(documentCommentService, 'create')
        .mockResolvedValueOnce({
          comment: comment('reply-2', { clientId: 'r2', parentCommentId: 'root-1' }),
          isDuplicate: false,
        })
        .mockRejectedValueOnce(new Error('offline'));

      await act(() =>
        documentCommentActions.createReply({
          input: {
            clientId: 'r2',
            content: 'r2',
            documentId: DOCUMENT_ID,
            parentCommentId: 'root-1',
          },
          optimisticComment: comment('optimistic:r2', {
            clientId: 'r2',
            parentCommentId: 'root-1',
          }),
          rootCommentId: 'root-1',
        }),
      );

      expect(state().replyFeedMap['root-1']?.items.map(({ id }) => id)).toEqual([
        'reply-1',
        'reply-2',
      ]);
      expect(state().replyFeedMap['root-1']?.total).toBe(2);
      expect(state().threadFeedMap[LIST_KEY]?.items[0].replyCount).toBe(2);
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });

      await act(async () => {
        await expect(
          documentCommentActions.createReply({
            input: {
              clientId: 'r3',
              content: 'r3',
              documentId: DOCUMENT_ID,
              parentCommentId: 'root-1',
            },
            optimisticComment: comment('optimistic:r3', {
              clientId: 'r3',
              parentCommentId: 'root-1',
            }),
            rootCommentId: 'root-1',
          }),
        ).rejects.toThrow('offline');
      });

      expect(create).toHaveBeenCalledTimes(2);
      expect(state().replyFeedMap['root-1']?.items).toHaveLength(2);
      expect(state().threadFeedMap[LIST_KEY]?.items[0].replyCount).toBe(2);
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });
    });

    it('re-reads a root feed that had no view when the root was sent', async () => {
      const created = comment('root-2', { clientId: 'new' });
      const listThreads = vi
        .spyOn(documentCommentService, 'listThreads')
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ items: [{ replyCount: 0, root: created }], nextCursor: null });
      vi.spyOn(documentCommentService, 'create').mockResolvedValue({
        comment: created,
        isDuplicate: false,
      });

      renderHook(() => documentCommentActions.useFetchThreads(LIST), { wrapper });
      await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(1));
      expect(state().threadFeedMap[LIST_KEY]).toBeUndefined();

      await act(() =>
        documentCommentActions.createRootComment({
          input: { clientId: 'new', content: 'new', documentId: DOCUMENT_ID },
          optimisticComment: comment('optimistic:new', { clientId: 'new' }),
        }),
      );

      await waitFor(() => expect(rootIds(state().threadFeedMap[LIST_KEY])).toEqual(['root-2']));
    });

    it('re-reads a reply feed that had no view when the reply was sent', async () => {
      const created = comment('reply-2', { clientId: 'r2', parentCommentId: 'root-1' });
      const listReplies = vi
        .spyOn(documentCommentService, 'listReplies')
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ hasMore: false, items: [created], total: 1 } as never);
      vi.spyOn(documentCommentService, 'create').mockResolvedValue({
        comment: created,
        isDuplicate: false,
      });

      renderHook(() => documentCommentActions.useFetchReplies('root-1'), { wrapper });
      await waitFor(() => expect(listReplies).toHaveBeenCalledTimes(1));
      expect(state().replyFeedMap['root-1']).toBeUndefined();

      await act(() =>
        documentCommentActions.createReply({
          input: {
            clientId: 'r2',
            content: 'r2',
            documentId: DOCUMENT_ID,
            parentCommentId: 'root-1',
          },
          optimisticComment: comment('optimistic:r2', {
            clientId: 'r2',
            parentCommentId: 'root-1',
          }),
          rootCommentId: 'root-1',
        }),
      );

      await waitFor(() =>
        expect(state().replyFeedMap['root-1']?.items.map(({ id }) => id)).toEqual(['reply-2']),
      );
    });

    it('rolls a failed edit back on every painted copy', async () => {
      seed();
      act(() =>
        useDocumentCommentStore.setState({
          detailMap: { 'root-1': { ...comment('root-1'), replyCount: 1 } },
        }),
      );
      const request = deferred<DocumentCommentItem>();
      vi.spyOn(documentCommentService, 'update').mockReturnValue(request.promise as never);

      let done!: Promise<unknown>;
      act(() => {
        done = documentCommentActions.updateComment(comment('root-1'), {
          content: 'edited',
          editorData: null,
        });
      });
      expect(state().threadFeedMap[LIST_KEY]?.items[0].root.content).toBe('edited');
      expect(state().detailMap['root-1']?.content).toBe('edited');

      await act(async () => {
        request.reject(new Error('offline'));
        await done.catch(() => undefined);
      });

      expect(state().threadFeedMap[LIST_KEY]?.items[0].root.content).toBe('root-1');
      expect(state().detailMap['root-1']).toMatchObject({ content: 'root-1', replyCount: 1 });
    });
  });

  describe('counters rebased mid-create', () => {
    // The creator window gets its own `document.commentsChanged` fanout, so an
    // event revalidation can land the server count that already includes the
    // new comment while `create()` is still in flight.
    it('does not count a new root twice when the summary is re-read mid-create', async () => {
      vi.spyOn(documentCommentService, 'listThreads').mockResolvedValue({
        items: [thread('root-1')],
        nextCursor: null,
      });
      const summary = vi.spyOn(documentCommentService, 'summary').mockResolvedValue({ total: 2 });
      renderHook(
        () => {
          documentCommentActions.useFetchThreads(LIST);
          documentCommentActions.useFetchSummary(DOCUMENT_ID);
        },
        { wrapper },
      );
      await waitFor(() => expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 2 }));
      await waitFor(() => expect(state().threadFeedMap[LIST_KEY]).toBeDefined());

      const request = deferred<{ comment: DocumentCommentItem; isDuplicate: boolean }>();
      vi.spyOn(documentCommentService, 'create').mockReturnValue(request.promise as never);
      let done!: Promise<unknown>;
      act(() => {
        done = documentCommentActions.createRootComment({
          input: { clientId: 'new', content: 'new', documentId: DOCUMENT_ID },
          optimisticComment: comment('optimistic:new', { clientId: 'new' }),
        });
      });
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });

      // The server already counts the new root.
      summary.mockResolvedValue({ total: 3 });
      await act(() => documentCommentActions.revalidateSummary(DOCUMENT_ID));
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });

      await act(async () => {
        request.resolve({ comment: comment('root-2', { clientId: 'new' }), isDuplicate: false });
        await done;
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });
    });

    it('does not count a new reply twice when the thread and summary are re-read mid-create', async () => {
      const listThreads = vi.spyOn(documentCommentService, 'listThreads').mockResolvedValue({
        items: [thread('root-1', 1)],
        nextCursor: null,
      });
      const summary = vi.spyOn(documentCommentService, 'summary').mockResolvedValue({ total: 2 });
      renderHook(
        () => {
          documentCommentActions.useFetchThreads(LIST);
          documentCommentActions.useFetchSummary(DOCUMENT_ID);
        },
        { wrapper },
      );
      await waitFor(() => expect(state().threadFeedMap[LIST_KEY]?.items[0].replyCount).toBe(1));
      await waitFor(() => expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 2 }));

      const request = deferred<{ comment: DocumentCommentItem; isDuplicate: boolean }>();
      vi.spyOn(documentCommentService, 'create').mockReturnValue(request.promise as never);
      vi.spyOn(documentCommentService, 'listReplies').mockResolvedValue({
        items: [],
        nextCursor: null,
      });
      let done!: Promise<unknown>;
      act(() => {
        done = documentCommentActions.createReply({
          input: {
            clientId: 'r2',
            content: 'r2',
            documentId: DOCUMENT_ID,
            parentCommentId: 'root-1',
          },
          optimisticComment: comment('optimistic:r2', {
            clientId: 'r2',
            parentCommentId: 'root-1',
          }),
          rootCommentId: 'root-1',
        });
      });
      expect(state().threadFeedMap[LIST_KEY]?.items[0].replyCount).toBe(2);

      // The server already counts the new reply.
      listThreads.mockResolvedValue({ items: [thread('root-1', 2)], nextCursor: null });
      summary.mockResolvedValue({ total: 3 });
      await act(() =>
        Promise.all([
          documentCommentActions.revalidateThreads(LIST),
          documentCommentActions.revalidateSummary(DOCUMENT_ID),
        ]),
      );
      expect(state().threadFeedMap[LIST_KEY]?.items[0].replyCount).toBe(2);
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });

      await act(async () => {
        request.resolve({
          comment: comment('reply-2', { clientId: 'r2', parentCommentId: 'root-1' }),
          isDuplicate: false,
        });
        await done;
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(state().threadFeedMap[LIST_KEY]?.items[0].replyCount).toBe(2);
      expect(state().summaryMap[DOCUMENT_ID]).toEqual({ total: 3 });
    });
  });

  describe('likes', () => {
    const summary: DocumentLikeSummary = { liked: true, likers: [], total: 7 };

    it('paints the persisted like summary before the network answers', async () => {
      await documentLikeSummaryResource.storage!.set(
        { queryKey: DOCUMENT_ID, scope },
        { data: summary, updatedAt: 1 },
      );
      vi.spyOn(documentLikeService, 'summary').mockImplementation(pending);

      renderHook(() => documentCommentActions.useFetchLikeSummary(DOCUMENT_ID), { wrapper });

      await waitFor(() => expect(state().likeSummaryMap[DOCUMENT_ID]).toEqual(summary));
    });

    it('keeps an optimistic toggle in memory and persists only the server answer', async () => {
      act(() =>
        useDocumentCommentStore.setState({
          likeSummaryMap: { [DOCUMENT_ID]: { liked: false, likers: [], total: 6 } },
        }),
      );

      act(() => {
        documentCommentActions.applyLikeSummary(DOCUMENT_ID, (current) => ({
          ...current,
          liked: true,
          total: current.total + 1,
        }));
      });
      expect(state().likeSummaryMap[DOCUMENT_ID]).toMatchObject({ liked: true, total: 7 });

      act(() => {
        documentCommentActions.confirmLikeSummary(DOCUMENT_ID, summary);
      });
      await waitFor(async () => {
        const row = await documentLikeSummaryResource.storage!.get({
          queryKey: DOCUMENT_ID,
          scope,
        });
        expect(row?.data).toEqual(summary);
      });
    });
  });
});
