/**
 * @vitest-environment happy-dom
 */
import type { TopicCommentItem, TopicCommentSummary, TopicCommentThread } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { topicCommentThreadsKey, useTopicCommentStore } from '@/store/topicComment';

import {
  useMessageCommentCount,
  usePrefetchTopicCommentsOnTopicLoad,
  useTopicCommentDetail,
  useTopicCommentMutations,
  useTopicCommentReplies,
  useTopicCommentSummary,
  useTopicCommentThreads,
} from './hooks';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  listReplies: vi.fn(),
  listThreads: vi.fn(),
  mutate: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  syncError: undefined as unknown,
  topicId: 'topic-1' as string | null,
  update: vi.fn(),
  useClientDataSWR: vi.fn(),
  user: {
    avatar: 'https://example.com/avatar.png',
    fullName: 'Current User',
    id: 'user-1',
    username: 'current-user',
  },
  workspaceId: 'workspace-1' as string | null,
}));

// The topic-comment reads are replicas: `useSync` only orchestrates fetching,
// the store views are the source of truth. The mocked hook below stands in for
// the sync driver, so tests seed the views directly (see the `seed*` helpers).
vi.mock('@/libs/swr', () => ({
  mutate: mocks.mutate,
  useClientDataSWR: mocks.useClientDataSWR,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.workspaceId,
}));

// Every replica resolves its identity partition through the app cache scope.
// Pin it so the mocked user store below never has to answer the scope selectors.
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'user-1:workspace-1',
  isScopeTrusted: () => false,
  useCacheScope: () => 'user-1:workspace-1',
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: mocks.user }),
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { user: unknown }) => state.user },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTopicId: mocks.topicId }),
}));

vi.mock('@/services/topicComment', () => ({
  topicCommentService: {
    create: mocks.create,
    delete: mocks.remove,
    get: mocks.get,
    listReplies: mocks.listReplies,
    listThreads: mocks.listThreads,
    restore: mocks.restore,
    update: mocks.update,
  },
}));

/** Persisted root feed of one topic view, as the store view holds it. */
const seedThreads = (
  topicId: string,
  items: TopicCommentThread[],
  options: {
    hasMore?: boolean;
    isLoadingMore?: boolean;
    loadMoreError?: unknown;
    messageId?: string;
    nextCursor?: string | null;
  } = {},
) =>
  useTopicCommentStore.setState((state) => ({
    threadFeedMap: {
      ...state.threadFeedMap,
      [topicCommentThreadsKey({ messageId: options.messageId, topicId })]: {
        currentPage: 0,
        hasMore: options.hasMore ?? false,
        isLoadingMore: options.isLoadingMore,
        items,
        loadMoreError: options.loadMoreError,
        nextCursor: options.nextCursor ?? null,
        total: items.length,
      },
    },
  }));

const seedReplies = (rootCommentId: string, items: TopicCommentItem[], total?: number) =>
  useTopicCommentStore.setState((state) => ({
    replyFeedMap: {
      ...state.replyFeedMap,
      [rootCommentId]: {
        currentPage: 0,
        hasMore: false,
        items,
        nextCursor: null,
        total: total ?? items.length,
      },
    },
  }));

const seedSummary = (topicId: string, summary: TopicCommentSummary) =>
  useTopicCommentStore.setState((state) => ({
    commentSummaryMap: { ...state.commentSummaryMap, [topicId]: summary },
  }));

const seedDetail = (comment: TopicCommentItem) =>
  useTopicCommentStore.setState((state) => ({
    commentDetailMap: { ...state.commentDetailMap, [comment.id]: comment },
  }));

const createComment = (overrides: Partial<TopicCommentItem> = {}): TopicCommentItem => ({
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
  clientId: 'client-1',
  content: 'Original comment',
  createdAt: new Date('2026-07-20T00:00:00.000Z'),
  deletedAt: null,
  editorData: null,
  id: 'comment-1',
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

const threadOf = (root: TopicCommentItem, replyCount = 0): TopicCommentThread => ({
  replyCount,
  root,
});

describe('useTopicCommentMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopicCommentStore.getState().reset();
    mocks.get.mockResolvedValue(undefined);
    mocks.listReplies.mockResolvedValue({ items: [], nextCursor: null });
    mocks.listThreads.mockResolvedValue({ items: [], nextCursor: null });
    mocks.mutate.mockResolvedValue(undefined);
    mocks.syncError = undefined;
    mocks.topicId = 'topic-1';
    mocks.useClientDataSWR.mockImplementation(() => ({
      data: undefined,
      error: mocks.syncError,
      isValidating: false,
    }));
    mocks.workspaceId = 'workspace-1';
  });

  it('returns a successful create even when background cache refresh fails', async () => {
    const response = { comment: { id: 'comment-1' }, isDuplicate: false };
    mocks.create.mockResolvedValue(response);
    mocks.mutate.mockRejectedValue(new Error('refresh failed'));
    const { result } = renderHook(() => useTopicCommentMutations());

    await act(async () => {
      await expect(
        result.current.create({
          clientId: 'client-1',
          content: 'Hello',
          topicId: 'topic-1',
        }),
      ).resolves.toBe(response);
    });

    expect(mocks.create).toHaveBeenCalledWith({
      clientId: 'client-1',
      content: 'Hello',
      topicId: 'topic-1',
    });
    expect(result.current.creating).toBe(false);
  });

  it('keeps mutation failures observable to preserve the draft for retry', async () => {
    mocks.create.mockRejectedValue(new Error('network failed'));
    const { result } = renderHook(() => useTopicCommentMutations());

    await act(async () => {
      await expect(
        result.current.create({
          clientId: 'client-1',
          content: 'Hello',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('network failed');
    });

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(result.current.creating).toBe(false);
  });

  it('shows a topic comment immediately and reconciles it without waiting for refresh', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    // The summary revalidation never settles: the list must update without it.
    mocks.mutate.mockReturnValue(new Promise(() => undefined));
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.create({
        clientId: 'client-1',
        content: 'Optimistic comment',
        topicId: 'topic-1',
      });
    });

    await waitFor(() =>
      expect(threads.result.current.items[0]?.root).toMatchObject({
        clientId: 'client-1',
        content: 'Optimistic comment',
      }),
    );
    expect(threads.result.current.pendingCommentIds.has('optimistic-topic-comment-client-1')).toBe(
      true,
    );

    await act(async () => {
      resolveCreate?.({
        comment: {
          ...threads.result.current.items[0].root,
          canDelete: true,
          canEdit: true,
          id: 'comment-1',
        },
        isDuplicate: false,
      });
      await request;
    });

    expect(threads.result.current.items[0].root.id).toBe('comment-1');
    expect(threads.result.current.pendingCommentIds.has('comment-1')).toBe(false);
    expect(mutations.result.current.creating).toBe(false);

    // The confirmed row paints from the store, before the feed revalidates.
    const reconciledRoot = threads.result.current.items[0].root;
    seedThreads('topic-1', [threadOf(reconciledRoot)]);
    threads.rerender();

    await waitFor(() =>
      expect(Object.keys(useTopicCommentStore.getState().optimisticComments)).toHaveLength(0),
    );
    expect(threads.result.current.items).toHaveLength(1);
    expect(threads.result.current.items[0].root.id).toBe('comment-1');
  });

  it('rolls back an optimistic topic comment when creation fails', async () => {
    let rejectCreate: ((reason: unknown) => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.create({
        clientId: 'client-1',
        content: 'Optimistic comment',
        topicId: 'topic-1',
      });
    });

    await waitFor(() => expect(threads.result.current.items).toHaveLength(1));
    await act(async () => {
      rejectCreate?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });

    expect(threads.result.current.items).toEqual([]);
  });

  it('optimistically updates and rolls back the topic summary count', async () => {
    let rejectCreate: ((reason: unknown) => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    seedSummary('topic-1', { countByMessage: {}, total: 4 });
    const mutations = renderHook(() => useTopicCommentMutations());
    const summary = renderHook(() => useTopicCommentSummary('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.create({
        clientId: 'client-1',
        content: 'Optimistic comment',
        topicId: 'topic-1',
      });
    });

    await waitFor(() => expect(summary.result.current.data?.total).toBe(5));

    await act(async () => {
      rejectCreate?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });
    expect(summary.result.current.data?.total).toBe(4);
  });

  it('does not double-count an idempotent retry after the server confirms it', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    seedSummary('topic-1', { countByMessage: {}, total: 4 });
    const mutations = renderHook(() => useTopicCommentMutations());
    const summary = renderHook(() => useTopicCommentSummary('topic-1'));
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.create({
        clientId: 'client-1',
        content: 'Retried comment',
        topicId: 'topic-1',
      });
    });

    await waitFor(() => expect(summary.result.current.data?.total).toBe(5));
    await act(async () => {
      resolveCreate?.({
        comment: {
          ...threads.result.current.items[0].root,
          id: 'comment-1',
        },
        isDuplicate: true,
      });
      await request;
    });

    expect(summary.result.current.data?.total).toBe(4);
    expect(threads.result.current.pendingCommentIds.has('comment-1')).toBe(false);
    // A duplicate only asks the summary entry to revalidate: it is never patched twice.
    expect(mocks.mutate.mock.calls.some(([key]) => typeof key === 'function')).toBe(true);
    expect(useTopicCommentStore.getState().commentSummaryMap['topic-1'].total).toBe(4);
  });

  it('shows a message comment in both its message scope and the topic-wide scope', async () => {
    let rejectCreate: ((reason: unknown) => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    const mutations = renderHook(() => useTopicCommentMutations());
    const topicThreads = renderHook(() => useTopicCommentThreads('topic-1'));
    const messageThreads = renderHook(() => useTopicCommentThreads('topic-1', 'message-1'));
    const otherMessageThreads = renderHook(() => useTopicCommentThreads('topic-1', 'message-2'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.create({
        clientId: 'client-1',
        content: 'Message comment',
        messageId: 'message-1',
        topicId: 'topic-1',
      });
    });

    await waitFor(() => expect(topicThreads.result.current.items).toHaveLength(1));
    expect(messageThreads.result.current.items).toHaveLength(1);
    expect(otherMessageThreads.result.current.items).toEqual([]);

    await act(async () => {
      rejectCreate?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });
  });

  it('keeps an optimistic reply out of root threads', async () => {
    let rejectCreate: ((reason: unknown) => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));
    const replies = renderHook(() => useTopicCommentReplies('root-comment-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.create({
        clientId: 'client-1',
        content: 'Reply',
        parentCommentId: 'root-comment-1',
        topicId: 'topic-1',
      });
    });

    await waitFor(() => expect(replies.result.current.items).toHaveLength(1));
    expect(threads.result.current.items).toEqual([]);

    await act(async () => {
      rejectCreate?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });
  });

  it('optimistically increments a root reply count and keeps it until the list reconciles', async () => {
    const root = createComment({ id: 'root-comment-1' });
    let resolveCreate: ((value: unknown) => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    seedThreads('topic-1', [threadOf(root, 2)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.create(
        {
          clientId: 'reply-client-1',
          content: 'Reply',
          parentCommentId: root.id,
          topicId: 'topic-1',
        },
        { rootReplyCount: 2 },
      );
    });

    await waitFor(() => expect(threads.result.current.items[0].replyCount).toBe(3));

    const reply = createComment({
      clientId: 'reply-client-1',
      id: 'reply-1',
      parentCommentId: root.id,
    });
    await act(async () => {
      resolveCreate?.({ comment: reply, isDuplicate: false });
      await request;
    });

    expect(threads.result.current.items[0].replyCount).toBe(3);
    expect(
      useTopicCommentStore.getState().optimisticReplyCountMutations['reply-client-1']?.pending,
    ).toBe(false);

    seedThreads('topic-1', [threadOf(root, 3)]);
    threads.rerender();

    await waitFor(() =>
      expect(
        useTopicCommentStore.getState().optimisticReplyCountMutations['reply-client-1'],
      ).toBeUndefined(),
    );
    expect(threads.result.current.items[0].replyCount).toBe(3);
  });

  it('clears the optimistic reply count delta when a retried create is duplicate', async () => {
    const root = createComment({ id: 'root-comment-1' });
    const reply = createComment({
      clientId: 'reply-client-1',
      id: 'reply-1',
      parentCommentId: root.id,
    });
    mocks.create.mockResolvedValue({ comment: reply, isDuplicate: true });
    seedThreads('topic-1', [threadOf(root, 3)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    await act(async () => {
      await mutations.result.current.create(
        {
          clientId: 'reply-client-1',
          content: 'Retried reply',
          parentCommentId: root.id,
          topicId: 'topic-1',
        },
        { rootReplyCount: 3 },
      );
    });

    expect(useTopicCommentStore.getState().optimisticReplyCountMutations).toEqual({});
    expect(threads.result.current.items[0].replyCount).toBe(3);
  });

  it('optimistically decrements a root reply count and rolls it back when delete fails', async () => {
    const root = createComment({ id: 'root-comment-1' });
    const reply = createComment({ id: 'reply-1', parentCommentId: root.id });
    let rejectDelete: ((reason: unknown) => void) | undefined;
    mocks.remove.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );
    seedThreads('topic-1', [threadOf(root, 2)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.remove(reply, 'hard', { rootReplyCount: 2 });
    });

    await waitFor(() => expect(threads.result.current.items[0].replyCount).toBe(1));

    await act(async () => {
      rejectDelete?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });

    expect(threads.result.current.items[0].replyCount).toBe(2);
    expect(useTopicCommentStore.getState().optimisticReplyCountMutations).toEqual({});
  });

  it('does not leave a stale count after settled reply operations cancel each other out', async () => {
    const root = createComment({ id: 'root-comment-1' });
    useTopicCommentStore.getState().upsertOptimisticReplyCountMutation({
      baselineCount: 2,
      delta: 1,
      id: 'create:reply-1',
      pending: false,
      rootCommentId: root.id,
      topicId: root.topicId,
      workspaceId: root.workspaceId,
    });
    useTopicCommentStore.getState().upsertOptimisticReplyCountMutation({
      baselineCount: 3,
      delta: -1,
      id: 'delete:reply-1',
      pending: false,
      rootCommentId: root.id,
      topicId: root.topicId,
      workspaceId: root.workspaceId,
    });
    seedThreads('topic-1', [threadOf(root, 2)]);

    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(threads.result.current.items[0].replyCount).toBe(2);
    await waitFor(() =>
      expect(useTopicCommentStore.getState().optimisticReplyCountMutations).toEqual({}),
    );
  });

  it('shows an edit immediately, keeps it over stale data, and reconciles the server result', async () => {
    const comment = createComment();
    let resolveUpdate: ((value: TopicCommentItem) => void) | undefined;
    mocks.update.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    seedThreads('topic-1', [threadOf(comment)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.update(
        { content: 'Edited comment', id: comment.id },
        comment,
      );
    });

    await waitFor(() =>
      expect(threads.result.current.items[0].root.content).toBe('Edited comment'),
    );

    const confirmed = createComment({
      content: 'Edited comment',
      updatedAt: new Date('2026-07-21T00:00:00.000Z'),
    });
    await act(async () => {
      resolveUpdate?.(confirmed);
      await request;
    });

    expect(threads.result.current.items[0].root).toEqual(confirmed);
    // The confirmed write lands in the by-id detail view, not in a detail SWR key.
    expect(useTopicCommentStore.getState().commentDetailMap[comment.id]).toEqual(confirmed);
    expect(mocks.mutate.mock.calls.some(([key]) => Array.isArray(key))).toBe(false);

    seedThreads('topic-1', [threadOf(confirmed)]);
    threads.rerender();
    await waitFor(() =>
      expect(useTopicCommentStore.getState().optimisticMutations[comment.id]).toBeUndefined(),
    );
    expect(threads.result.current.items[0].root).toEqual(confirmed);
  });

  it('rolls back an optimistic edit when the request fails', async () => {
    const comment = createComment();
    let rejectUpdate: ((reason: unknown) => void) | undefined;
    mocks.update.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    seedThreads('topic-1', [threadOf(comment)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.update(
        { content: 'Edited comment', id: comment.id },
        comment,
      );
    });
    await waitFor(() =>
      expect(threads.result.current.items[0].root.content).toBe('Edited comment'),
    );

    await act(async () => {
      rejectUpdate?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });

    expect(threads.result.current.items[0].root).toEqual(comment);
    expect(useTopicCommentStore.getState().optimisticMutations).toEqual({});
  });

  it('applies an optimistic edit to the standalone thread detail', async () => {
    const comment = createComment();
    let rejectUpdate: ((reason: unknown) => void) | undefined;
    mocks.update.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    seedDetail(comment);
    const mutations = renderHook(() => useTopicCommentMutations());
    const detail = renderHook(() => useTopicCommentDetail(comment.id));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.update(
        { content: 'Edited detail', id: comment.id },
        comment,
      );
    });

    await waitFor(() => expect(detail.result.current.data?.content).toBe('Edited detail'));
    await act(async () => {
      rejectUpdate?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });
    expect(detail.result.current.data).toEqual(comment);
  });

  it('keeps a root visible during a pending hard delete and hides it after confirmation', () => {
    const comment = createComment();
    seedDetail(comment);
    useTopicCommentStore.getState().upsertOptimisticMutation({
      comment,
      deleteMode: 'hard',
      kind: 'delete',
      pending: true,
    });
    const detail = renderHook(() => useTopicCommentDetail(comment.id));

    expect(detail.result.current.data).toEqual(comment);
    expect(detail.result.current.isDeleting).toBe(true);

    act(() => {
      useTopicCommentStore.getState().upsertOptimisticMutation({
        comment,
        deleteMode: 'hard',
        kind: 'delete',
        pending: false,
      });
    });

    expect(detail.result.current.data).toBeUndefined();
    expect(detail.result.current.isDeleting).toBe(true);
  });

  it('clears retained detail data when revalidation reports not found', () => {
    const comment = createComment({ id: 'deleted-reply', parentCommentId: 'comment-1' });
    seedDetail(comment);
    mocks.syncError = { data: { code: 'NOT_FOUND' } };

    const detail = renderHook(() => useTopicCommentDetail(comment.id));

    expect(detail.result.current.data).toBeUndefined();
    expect(detail.result.current.error).toEqual({ data: { code: 'NOT_FOUND' } });
  });

  it('rolls a failed second edit back to the last confirmed optimistic value', async () => {
    const staleComment = createComment();
    const confirmedComment = createComment({
      content: 'First confirmed edit',
      updatedAt: new Date('2026-07-21T00:00:00.000Z'),
    });
    useTopicCommentStore.getState().upsertOptimisticMutation({
      comment: confirmedComment,
      kind: 'update',
      pending: false,
    });
    mocks.update.mockRejectedValue(new Error('network failed'));
    seedThreads('topic-1', [threadOf(staleComment)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    await act(async () => {
      await expect(
        mutations.result.current.update(
          { content: 'Second failed edit', id: staleComment.id },
          confirmedComment,
        ),
      ).rejects.toThrow('network failed');
    });

    expect(threads.result.current.items[0].root).toEqual(confirmedComment);
    expect(useTopicCommentStore.getState().optimisticMutations[staleComment.id]?.comment).toEqual(
      confirmedComment,
    );
  });

  it('hides a hard delete and decrements counts immediately, then rolls back on failure', async () => {
    const comment = createComment({ messageId: 'message-1' });
    let rejectDelete: ((reason: unknown) => void) | undefined;
    mocks.remove.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );
    seedSummary('topic-1', { countByMessage: { 'message-1': 1 }, total: 1 });
    seedThreads('topic-1', [threadOf(comment)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));
    const summary = renderHook(() => useTopicCommentSummary('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.remove(comment);
    });

    await waitFor(() => expect(threads.result.current.items).toEqual([]));
    expect(summary.result.current.data).toEqual({ countByMessage: {}, total: 0 });

    await act(async () => {
      rejectDelete?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });

    expect(threads.result.current.items[0].root).toEqual(comment);
    expect(summary.result.current.data).toEqual({ countByMessage: { 'message-1': 1 }, total: 1 });
  });

  it('keeps a confirmed hard delete hidden until refreshed data no longer contains it', async () => {
    const comment = createComment();
    mocks.remove.mockResolvedValue({ mode: 'hard' });
    mocks.mutate.mockReturnValue(new Promise(() => undefined));
    seedThreads('topic-1', [threadOf(comment)]);
    seedDetail(comment);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    await act(async () => {
      await mutations.result.current.remove(comment);
    });

    expect(threads.result.current.items).toEqual([]);
    expect(useTopicCommentStore.getState().optimisticMutations[comment.id]?.pending).toBe(false);
    // The by-id detail view drops the row; the feed reconciles it on the next sync.
    expect(useTopicCommentStore.getState().commentDetailMap[comment.id]).toBeUndefined();
    expect(mocks.mutate.mock.calls.some(([key]) => typeof key === 'function')).toBe(true);
    expect(mocks.mutate.mock.calls.some(([key]) => Array.isArray(key))).toBe(false);

    seedThreads('topic-1', []);
    threads.rerender();
    await waitFor(() =>
      expect(useTopicCommentStore.getState().optimisticMutations[comment.id]).toBeUndefined(),
    );
    expect(threads.result.current.items).toEqual([]);
  });

  it('shows an owner-moderated placeholder immediately and reconciles the server result', async () => {
    const comment = createComment({
      authorUserId: 'other-user',
      canEdit: false,
      messageId: 'message-1',
    });
    let resolveDelete:
      ((value: { comment: TopicCommentItem; mode: 'moderated' }) => void) | undefined;
    mocks.remove.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    seedSummary('topic-1', { countByMessage: { 'message-1': 1 }, total: 1 });
    seedThreads('topic-1', [threadOf(comment)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));
    const summary = renderHook(() => useTopicCommentSummary('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.remove(comment);
    });

    await waitFor(() => expect(threads.result.current.items[0].root.canRestore).toBe(true));
    expect(threads.result.current.items[0].root.content).toBe('Original comment');
    expect(summary.result.current.data).toEqual({ countByMessage: {}, total: 0 });

    const moderated = createComment({
      ...comment,
      canDelete: false,
      canEdit: false,
      canRestore: true,
      moderatedAt: new Date('2026-07-22T00:00:00.000Z'),
      moderationExpiresAt: new Date('2026-08-21T00:00:00.000Z'),
    });
    await act(async () => {
      resolveDelete?.({ comment: moderated, mode: 'moderated' });
      await request;
    });

    expect(threads.result.current.items[0].root).toEqual(moderated);
    expect(useTopicCommentStore.getState().commentDetailMap[comment.id]).toEqual(moderated);
  });

  it('restores a moderated comment immediately and rolls back when restore fails', async () => {
    const comment = createComment({
      authorUserId: 'other-user',
      canDelete: false,
      canEdit: false,
      canRestore: true,
      messageId: 'message-1',
      moderatedAt: new Date('2026-07-22T00:00:00.000Z'),
      moderationExpiresAt: new Date('2026-08-21T00:00:00.000Z'),
    });
    let rejectRestore: ((reason: unknown) => void) | undefined;
    mocks.restore.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRestore = reject;
      }),
    );
    seedSummary('topic-1', { countByMessage: {}, total: 0 });
    seedThreads('topic-1', [threadOf(comment)]);
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));
    const summary = renderHook(() => useTopicCommentSummary('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.restore(comment, { rootReplyCount: 0 });
    });

    await waitFor(() => expect(threads.result.current.items[0].root.moderatedAt).toBeNull());
    expect(summary.result.current.data).toEqual({
      countByMessage: { 'message-1': 1 },
      total: 1,
    });

    await act(async () => {
      rejectRestore?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });

    expect(threads.result.current.items[0].root).toEqual(comment);
    expect(summary.result.current.data).toEqual({ countByMessage: {}, total: 0 });
  });

  it('does not reconcile a confirmed hard delete against a list that has not loaded', async () => {
    const comment = createComment();
    useTopicCommentStore.getState().upsertOptimisticMutation({
      comment,
      deleteMode: 'hard',
      kind: 'delete',
      pending: false,
    });
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(useTopicCommentStore.getState().optimisticMutations[comment.id]).toBeDefined();

    seedThreads('topic-1', []);
    threads.rerender();
    await waitFor(() =>
      expect(useTopicCommentStore.getState().optimisticMutations[comment.id]).toBeUndefined(),
    );
  });

  it('optimistically hides and rolls back a deleted reply', async () => {
    const reply = createComment({ id: 'reply-1', parentCommentId: 'comment-1' });
    let rejectDelete: ((reason: unknown) => void) | undefined;
    mocks.remove.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );
    seedReplies('comment-1', [reply], 1);
    const mutations = renderHook(() => useTopicCommentMutations());
    const replies = renderHook(() => useTopicCommentReplies('comment-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.remove(reply);
    });

    await waitFor(() => expect(replies.result.current.items).toEqual([]));
    await act(async () => {
      rejectDelete?.(new Error('network failed'));
      await expect(request).rejects.toThrow('network failed');
    });
    expect(replies.result.current.items).toEqual([reply]);
  });

  it('shows a tombstone immediately for a root with replies and reconciles a soft delete', async () => {
    const comment = createComment({ messageId: 'message-1' });
    let resolveDelete: ((value: { mode: 'soft' }) => void) | undefined;
    mocks.remove.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    seedThreads('topic-1', [threadOf(comment, 2)]);
    seedSummary('topic-1', { countByMessage: { 'message-1': 1 }, total: 2 });
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));
    const summary = renderHook(() => useTopicCommentSummary('topic-1'));

    let request: Promise<unknown>;
    act(() => {
      request = mutations.result.current.remove(comment, 'soft');
    });

    await waitFor(() => expect(threads.result.current.items[0].root.deletedAt).not.toBeNull());
    expect(threads.result.current.items[0].root.content).toBe('');
    expect(summary.result.current.data).toEqual({
      countByMessage: { 'message-1': 1 },
      total: 1,
    });

    await act(async () => {
      resolveDelete?.({ mode: 'soft' });
      await request;
    });
    expect(threads.result.current.items[0].root.deletedAt).not.toBeNull();

    const tombstone = createComment({
      canDelete: false,
      canEdit: false,
      content: '',
      deletedAt: new Date('2026-07-21T00:00:00.000Z'),
      updatedAt: new Date('2026-07-21T00:00:00.000Z'),
    });
    seedThreads('topic-1', [threadOf(tombstone, 2)]);
    threads.rerender();

    await waitFor(() =>
      expect(useTopicCommentStore.getState().optimisticMutations[comment.id]).toBeUndefined(),
    );
    expect(threads.result.current.items[0].root).toEqual(tombstone);
  });
});

describe('topic comment read hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopicCommentStore.getState().reset();
    mocks.listReplies.mockResolvedValue({ items: [], nextCursor: null });
    mocks.listThreads.mockResolvedValue({ items: [], nextCursor: null });
    mocks.syncError = undefined;
    mocks.topicId = 'topic-1';
    mocks.useClientDataSWR.mockImplementation(() => ({
      data: undefined,
      error: mocks.syncError,
      isValidating: false,
    }));
    mocks.workspaceId = 'workspace-1';
  });

  it('reads a message badge from the root-thread summary', () => {
    seedSummary('topic-1', { countByMessage: { 'message-1': 3 }, total: 8 });

    const { result } = renderHook(() => useMessageCommentCount('message-1'));

    expect(result.current).toEqual({ count: 3, topicId: 'topic-1' });
  });

  it('warms and caches the topic first page before the summary loads', async () => {
    const page = { items: [threadOf({ id: 'comment-1' } as TopicCommentItem)], nextCursor: null };
    mocks.listThreads.mockResolvedValue(page);

    renderHook(() => usePrefetchTopicCommentsOnTopicLoad('topic-1'));

    await waitFor(() =>
      expect(
        useTopicCommentStore.getState().threadFeedMap[
          topicCommentThreadsKey({ topicId: 'topic-1' })
        ]?.items,
      ).toHaveLength(1),
    );
    expect(mocks.listThreads).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 30,
      messageId: undefined,
      topicId: 'topic-1',
    });
  });

  it('warms and caches first-page replies for roots that have replies', async () => {
    const threadPage = {
      items: [
        threadOf({ id: 'comment-1' } as TopicCommentItem, 2),
        threadOf({ id: 'comment-2' } as TopicCommentItem),
      ],
      nextCursor: null,
    };
    const replyPage = { items: [createComment({ id: 'reply-1' })], nextCursor: null, total: 1 };
    mocks.listThreads.mockResolvedValue(threadPage);
    mocks.listReplies.mockResolvedValue(replyPage);

    renderHook(() => usePrefetchTopicCommentsOnTopicLoad('topic-1'));

    await waitFor(() =>
      expect(useTopicCommentStore.getState().replyFeedMap['comment-1']?.items).toHaveLength(1),
    );
    expect(mocks.listReplies).toHaveBeenCalledOnce();
    expect(mocks.listReplies).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 30,
      rootCommentId: 'comment-1',
    });
  });

  it('keeps a failed topic warmup retryable and caches a later successful retry', async () => {
    const page = { items: [threadOf({ id: 'comment-1' } as TopicCommentItem)], nextCursor: null };
    mocks.listThreads
      .mockRejectedValueOnce(new Error('prefetch failed'))
      .mockResolvedValueOnce(page);

    renderHook(() => usePrefetchTopicCommentsOnTopicLoad('topic-1'));

    await waitFor(() => expect(mocks.listThreads).toHaveBeenCalledOnce());
    expect(
      useTopicCommentStore.getState().threadFeedMap[topicCommentThreadsKey({ topicId: 'topic-1' })],
    ).toBeUndefined();

    // The warmup is best-effort: a later attempt fills the same view.
    await act(async () => {
      await useTopicCommentStore.getState().prefetchTopicComments('topic-1');
    });

    expect(
      useTopicCommentStore.getState().threadFeedMap[topicCommentThreadsKey({ topicId: 'topic-1' })]
        ?.items,
    ).toHaveLength(1);
  });

  it('warms only the bounded topic feed, not a warmup SWR key', async () => {
    renderHook(() => usePrefetchTopicCommentsOnTopicLoad('topic-1'));

    await waitFor(() => expect(mocks.listThreads).toHaveBeenCalledOnce());
    expect(mocks.listThreads).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 30,
      messageId: undefined,
      topicId: 'topic-1',
    });
    expect(
      mocks.useClientDataSWR.mock.calls.some(([key]) =>
        JSON.stringify(key ?? '').includes('topicComment:warmup'),
      ),
    ).toBe(false);
  });

  it('refreshes only the affected summary after a comment write', async () => {
    const response = { comment: createComment({ id: 'comment-1' }), isDuplicate: false };
    mocks.create.mockResolvedValue(response);
    const { result } = renderHook(() => useTopicCommentMutations());

    await act(async () => {
      await result.current.create({
        clientId: 'client-1',
        content: 'Hello',
        topicId: 'topic-1',
      });
    });

    // The summary entry is revalidated through the replica match, never a raw SWR key.
    expect(mocks.mutate.mock.calls.some(([key]) => typeof key === 'function')).toBe(true);
    expect(
      mocks.mutate.mock.calls.some(
        ([key]) => Array.isArray(key) && key[0] === 'topicComment:summary',
      ),
    ).toBe(false);
  });

  it('reads the persisted topic feed before the network confirms it', () => {
    const thread = threadOf({ id: 'comment-1' } as TopicCommentItem);
    seedThreads('topic-1', [thread]);

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(result.current.items).toEqual([thread]);
    expect(result.current.isLoadingInitial).toBe(false);
  });

  it('reads the persisted reply feed before the network confirms it', () => {
    const reply = createComment({ id: 'reply-1', parentCommentId: 'comment-1' });
    seedReplies('comment-1', [reply], 1);

    const { result } = renderHook(() => useTopicCommentReplies('comment-1', 1));

    expect(result.current.items).toEqual([reply]);
    expect(result.current.total).toBe(1);
  });

  it('shows an empty topic feed as loaded when the summary reports no comments', () => {
    seedSummary('topic-1', { countByMessage: { 'message-without-comments': 0 }, total: 0 });
    seedThreads('topic-1', [], { messageId: 'message-without-comments' });

    const { result } = renderHook(() =>
      useTopicCommentThreads('topic-1', 'message-without-comments'),
    );

    expect(result.current.items).toEqual([]);
    expect(result.current.isLoadingInitial).toBe(false);
  });

  it('treats a zero reply snapshot as an immediate empty reply list', () => {
    const { result } = renderHook(() => useTopicCommentReplies('root-comment-1', 0));

    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.isLoadingInitial).toBe(false);
  });

  it('reload revalidates the feed entry it is showing', async () => {
    seedThreads('topic-1', [threadOf({ id: 'comment-1' } as TopicCommentItem)]);
    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    await act(async () => {
      await result.current.reload();
    });

    expect(mocks.mutate.mock.calls.some(([key]) => typeof key === 'function')).toBe(true);
  });

  it('keeps loaded threads visible while the next page is loading', () => {
    const thread = threadOf({ id: 'comment-1' } as TopicCommentItem, 2);
    seedThreads('topic-1', [thread], { hasMore: true, isLoadingMore: true });

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(result.current.items).toEqual([thread]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isLoadingMore).toBe(true);
  });

  it('exposes a tail error without turning it into an initial failure', () => {
    const error = new Error('next page failed');
    const thread = threadOf({ id: 'comment-1' } as TopicCommentItem);
    seedThreads('topic-1', [thread], { hasMore: true, loadMoreError: error, nextCursor: 'c2' });

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(result.current.items).toEqual([thread]);
    expect(result.current.error).toBe(error);
    expect(result.current.isInitialError).toBe(false);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.hasMore).toBe(false);
  });

  it('retries the failed cursor request on reload instead of the head', async () => {
    const error = new Error('next page failed');
    const thread = threadOf({ id: 'comment-1' } as TopicCommentItem);
    seedThreads('topic-1', [thread], { hasMore: true, loadMoreError: error, nextCursor: 'c2' });

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    await act(async () => {
      await result.current.reload();
    });

    // The head-only revalidation cannot reach the page that failed: reload must
    // re-issue the cursor request.
    expect(mocks.listThreads).toHaveBeenCalledWith({
      cursor: 'c2',
      limit: 30,
      messageId: undefined,
      topicId: 'topic-1',
    });
  });

  it('revalidates the head when there is no tail error to retry', async () => {
    seedThreads('topic-1', [threadOf({ id: 'comment-1' } as TopicCommentItem)], {
      hasMore: true,
      nextCursor: 'c2',
    });

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    await act(async () => {
      await result.current.reload();
    });

    expect(mocks.mutate.mock.calls.some(([key]) => typeof key === 'function')).toBe(true);
    expect(mocks.listThreads).not.toHaveBeenCalled();
  });

  it('marks a first-page failure as an initial error', () => {
    mocks.syncError = new Error('first page failed');

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(result.current.items).toEqual([]);
    expect(result.current.isInitialError).toBe(true);
  });
});
