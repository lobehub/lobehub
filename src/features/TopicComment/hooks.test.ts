/**
 * @vitest-environment happy-dom
 */
import type { TopicCommentItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicCommentStore } from '@/store/topicComment';

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
  cacheGet: vi.fn(),
  create: vi.fn(),
  infiniteResponse: {} as Record<string, unknown>,
  listReplies: vi.fn(),
  listThreads: vi.fn(),
  mutate: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  scopedMutate: vi.fn(),
  topicId: 'topic-1' as string | null,
  update: vi.fn(),
  user: {
    avatar: 'https://example.com/avatar.png',
    fullName: 'Current User',
    id: 'user-1',
    username: 'current-user',
  },
  useClientDataSWR: vi.fn(),
  useSWRInfinite: vi.fn(),
  workspaceId: 'workspace-1' as string | null,
}));

vi.mock('@/libs/swr', () => ({
  mutate: mocks.mutate,
  useClientDataSWR: mocks.useClientDataSWR,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.workspaceId,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: mocks.user }),
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  userProfileSelectors: { userProfile: (state: { user: unknown }) => state.user },
}));

vi.mock('swr', () => ({
  unstable_serialize: (key: unknown) => JSON.stringify(key),
  useSWRConfig: () => ({
    cache: { get: mocks.cacheGet },
    mutate: mocks.scopedMutate,
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTopicId: mocks.topicId }),
}));

vi.mock('swr/infinite', () => ({
  default: (...args: unknown[]) => {
    mocks.useSWRInfinite(...args);
    return mocks.infiniteResponse;
  },
}));

vi.mock('@/services/topicComment', () => ({
  topicCommentService: {
    create: mocks.create,
    delete: mocks.remove,
    listReplies: mocks.listReplies,
    listThreads: mocks.listThreads,
    restore: mocks.restore,
    update: mocks.update,
  },
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

describe('useTopicCommentMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopicCommentStore.getState().reset();
    mocks.infiniteResponse = {
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: true,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
    mocks.cacheGet.mockReturnValue(undefined);
    mocks.mutate.mockResolvedValue(undefined);
    mocks.scopedMutate.mockResolvedValue(undefined);
    mocks.topicId = 'topic-1';
    mocks.useClientDataSWR.mockReturnValue({ data: undefined });
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
    let resolveRefresh: (() => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    mocks.mutate.mockImplementation((key) =>
      typeof key === 'function'
        ? new Promise<void>((resolve) => {
            resolveRefresh = resolve;
          })
        : Promise.resolve(undefined),
    );
    mocks.infiniteResponse = {
      data: [{ items: [], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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

    await act(async () => resolveRefresh?.());
    expect(threads.result.current.items[0].root.id).toBe('comment-1');

    const reconciledRoot = threads.result.current.items[0].root;
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 0, root: reconciledRoot }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.useClientDataSWR.mockReturnValue({
      data: { countByMessage: {}, total: 4 },
    });
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
    mocks.useClientDataSWR.mockReturnValue({
      data: { countByMessage: {}, total: 4 },
    });
    mocks.infiniteResponse = {
      data: [{ items: [], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    expect(
      mocks.mutate.mock.calls.some(([key]) =>
        Array.isArray(key) ? key[0] === 'topicComment:summary' : false,
      ),
    ).toBe(true);
  });

  it('shows a message comment in both its message scope and the topic-wide scope', async () => {
    let rejectCreate: ((reason: unknown) => void) | undefined;
    mocks.create.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    mocks.infiniteResponse = {
      data: [{ items: [], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 2, root }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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

    mocks.infiniteResponse = {
      ...mocks.infiniteResponse,
      data: [{ items: [{ replyCount: 3, root }], nextCursor: null }],
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 3, root }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 2, root }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 2, root }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };

    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(threads.result.current.items[0].replyCount).toBe(2);
    await waitFor(() =>
      expect(useTopicCommentStore.getState().optimisticReplyCountMutations).toEqual({}),
    );
  });

  it('shows an edit immediately, keeps it over stale data, and reconciles the server result', async () => {
    const comment = createComment();
    let resolveUpdate: ((value: TopicCommentItem) => void) | undefined;
    mocks.mutate.mockReturnValue(new Promise(() => undefined));
    mocks.update.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 0, root: comment }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    expect(mocks.mutate).toHaveBeenCalledWith(['topicComment:detail', comment.id], confirmed, {
      revalidate: false,
    });
    expect(mocks.mutate.mock.calls.some(([key]) => typeof key === 'function')).toBe(false);

    mocks.infiniteResponse = {
      ...mocks.infiniteResponse,
      data: [{ items: [{ replyCount: 0, root: confirmed }], nextCursor: null }],
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 0, root: comment }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.useClientDataSWR.mockReturnValue({ data: comment });
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
    mocks.useClientDataSWR.mockReturnValue({ data: comment });
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
    mocks.useClientDataSWR.mockReturnValue({
      data: comment,
      error: { data: { code: 'NOT_FOUND' } },
    });

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
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 0, root: staleComment }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.useClientDataSWR.mockReturnValue({
      data: { countByMessage: { 'message-1': 1 }, total: 1 },
    });
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 0, root: comment }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 0, root: comment }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
    const mutations = renderHook(() => useTopicCommentMutations());
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    await act(async () => {
      await mutations.result.current.remove(comment);
    });

    expect(threads.result.current.items).toEqual([]);
    expect(useTopicCommentStore.getState().optimisticMutations[comment.id]?.pending).toBe(false);
    expect(
      mocks.mutate.mock.calls.filter(
        ([key]) => Array.isArray(key) && key[0] === 'topicComment:summary',
      ),
    ).toHaveLength(1);
    expect(mocks.mutate).toHaveBeenCalledWith(['topicComment:detail', comment.id], undefined, {
      revalidate: false,
    });
    expect(mocks.mutate.mock.calls.some(([key]) => typeof key === 'function')).toBe(false);

    mocks.infiniteResponse = {
      ...mocks.infiniteResponse,
      data: [{ items: [], nextCursor: null }],
    };
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
    mocks.useClientDataSWR.mockReturnValue({
      data: { countByMessage: { 'message-1': 1 }, total: 1 },
    });
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 0, root: comment }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    expect(mocks.mutate).toHaveBeenCalledWith(['topicComment:detail', comment.id], moderated, {
      revalidate: false,
    });
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
    mocks.useClientDataSWR.mockReturnValue({ data: { countByMessage: {}, total: 0 } });
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 0, root: comment }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.infiniteResponse = {
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: true,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
    const threads = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(useTopicCommentStore.getState().optimisticMutations[comment.id]).toBeDefined();

    mocks.infiniteResponse = {
      ...mocks.infiniteResponse,
      data: [{ items: [], nextCursor: null }],
      isLoading: false,
      isValidating: false,
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [reply], nextCursor: null, total: 1 }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
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
    mocks.infiniteResponse = {
      data: [{ items: [{ replyCount: 2, root: comment }], nextCursor: null }],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
    mocks.useClientDataSWR.mockReturnValue({
      data: { countByMessage: { 'message-1': 1 }, total: 2 },
    });
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
    mocks.infiniteResponse = {
      ...mocks.infiniteResponse,
      data: [{ items: [{ replyCount: 2, root: tombstone }], nextCursor: null }],
    };
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
    mocks.cacheGet.mockReturnValue(undefined);
    mocks.scopedMutate.mockResolvedValue(undefined);
    mocks.topicId = 'topic-1';
    mocks.workspaceId = 'workspace-1';
    mocks.useClientDataSWR.mockReturnValue({ data: undefined });
  });

  it('reads a message badge from the root-thread summary', () => {
    mocks.useClientDataSWR.mockReturnValue({
      data: { countByMessage: { 'message-1': 3 }, total: 8 },
    });

    const { result } = renderHook(() => useMessageCommentCount('message-1'));

    expect(result.current).toEqual({ count: 3, topicId: 'topic-1' });
  });

  it('warms and caches the topic first page before the summary loads', async () => {
    const page = { items: [{ replyCount: 0, root: { id: 'comment-1' } }], nextCursor: null };
    mocks.listThreads.mockResolvedValue(page);
    mocks.useClientDataSWR.mockImplementation((key, fetcher) => {
      if (Array.isArray(key) && key[0] === 'topicComment:warmup') void fetcher();
      return { data: undefined };
    });

    renderHook(() => usePrefetchTopicCommentsOnTopicLoad('topic-1'));

    await waitFor(() =>
      expect(mocks.scopedMutate).toHaveBeenCalledWith(
        ['topicComment:threads', 'workspace-1', 'topic-1', '', ''],
        page,
        { revalidate: false },
      ),
    );
  });

  it('warms and caches first-page replies for roots that have replies', async () => {
    const threadPage = {
      items: [
        { replyCount: 2, root: { id: 'comment-1' } },
        { replyCount: 0, root: { id: 'comment-2' } },
      ],
      nextCursor: null,
    };
    const replyPage = { items: [{ id: 'reply-1' }], nextCursor: null, total: 1 };
    mocks.listThreads.mockResolvedValue(threadPage);
    mocks.listReplies.mockResolvedValue(replyPage);
    mocks.useClientDataSWR.mockImplementation((key, fetcher) => {
      if (Array.isArray(key) && key[0] === 'topicComment:warmup') void fetcher();
      return { data: undefined };
    });

    renderHook(() => usePrefetchTopicCommentsOnTopicLoad('topic-1'));

    await waitFor(() =>
      expect(mocks.scopedMutate).toHaveBeenCalledWith(
        ['topicComment:replies', 'workspace-1', 'comment-1', ''],
        replyPage,
        { revalidate: false },
      ),
    );
    expect(mocks.listReplies).toHaveBeenCalledOnce();
    expect(mocks.listReplies).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 30,
      rootCommentId: 'comment-1',
    });
  });

  it('keeps a failed topic warmup retryable and caches a later successful retry', async () => {
    const error = new Error('prefetch failed');
    const page = { items: [{ replyCount: 0, root: { id: 'comment-1' } }], nextCursor: null };
    let warmupFetcher: (() => Promise<boolean>) | undefined;
    mocks.listThreads.mockRejectedValueOnce(error).mockResolvedValueOnce(page);
    mocks.useClientDataSWR.mockImplementation((key, fetcher) => {
      if (Array.isArray(key) && key[0] === 'topicComment:warmup') warmupFetcher = fetcher;
      return { data: undefined };
    });

    renderHook(() => usePrefetchTopicCommentsOnTopicLoad('topic-1'));

    await expect(warmupFetcher?.()).rejects.toBe(error);
    await expect(warmupFetcher?.()).resolves.toBe(true);
    expect(mocks.scopedMutate).toHaveBeenCalledWith(
      ['topicComment:threads', 'workspace-1', 'topic-1', '', ''],
      page,
      { revalidate: false },
    );
  });

  it('registers only the bounded topic-level warmup', () => {
    renderHook(() => usePrefetchTopicCommentsOnTopicLoad('topic-1'));

    expect(mocks.useClientDataSWR).toHaveBeenCalledOnce();
    expect(mocks.useClientDataSWR).toHaveBeenCalledWith(
      ['topicComment:warmup', 'workspace-1', 'topic-1'],
      expect.any(Function),
      { revalidateOnFocus: false },
    );
  });

  it('refreshes only the affected summary after a comment write', async () => {
    const response = { comment: { id: 'comment-1' }, isDuplicate: false };
    mocks.create.mockResolvedValue(response);
    const { result } = renderHook(() => useTopicCommentMutations());

    await act(async () => {
      await result.current.create({
        clientId: 'client-1',
        content: 'Hello',
        topicId: 'topic-1',
      });
    });

    expect(mocks.mutate.mock.calls.some(([key]) => typeof key === 'function')).toBe(false);
    expect(
      mocks.mutate.mock.calls.filter(
        ([key]) => Array.isArray(key) && key[0] === 'topicComment:summary',
      ),
    ).toHaveLength(1);
    expect(
      mocks.mutate.mock.calls.some(
        ([key]) => Array.isArray(key) && key[0] === 'topicComment:warmup',
      ),
    ).toBe(false);
  });

  it('uses the summary as an immediate empty fallback while revalidating in the background', () => {
    mocks.useClientDataSWR.mockReturnValue({
      data: { countByMessage: {}, total: 0 },
    });

    renderHook(() => useTopicCommentThreads('topic-1', 'message-without-comments'));

    expect(mocks.useSWRInfinite).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        fallbackData: [{ items: [], nextCursor: null }],
        revalidateOnMount: true,
      }),
    );
  });

  it('uses a zero reply snapshot as an immediate empty fallback while revalidating', () => {
    renderHook(() => useTopicCommentReplies('root-comment-1', 0));

    expect(mocks.useSWRInfinite).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        fallbackData: [{ items: [], nextCursor: null, total: 0 }],
        revalidateOnMount: true,
      }),
    );
  });

  it('uses prefetched first-page replies as an immediate fallback while revalidating', () => {
    const page = { items: [{ id: 'reply-1' }], nextCursor: null, total: 1 };
    mocks.cacheGet.mockImplementation((key) =>
      key === JSON.stringify(['topicComment:replies', 'workspace-1', 'root-comment-1', ''])
        ? { data: page }
        : undefined,
    );

    renderHook(() => useTopicCommentReplies('root-comment-1', 1));

    expect(mocks.useSWRInfinite).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        fallbackData: [page],
        revalidateOnMount: true,
      }),
    );
  });

  it('uses a prefetched first page as an immediate fallback while revalidating', () => {
    const page = { items: [{ replyCount: 0, root: { id: 'comment-1' } }], nextCursor: null };
    mocks.cacheGet.mockReturnValue({ data: page });

    renderHook(() => useTopicCommentThreads('topic-1', 'message-1'));

    expect(mocks.useSWRInfinite).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        fallbackData: [page],
        revalidateOnMount: true,
      }),
    );
  });

  it('revalidates the first page when returning from a comment thread', () => {
    renderHook(() => useTopicCommentThreads('topic-1'));

    expect(mocks.useSWRInfinite).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ revalidateOnMount: true }),
    );
  });

  it('keeps loaded threads visible while the next page is loading', () => {
    const thread = {
      replyCount: 2,
      root: { id: 'comment-1' },
    };
    mocks.infiniteResponse = {
      data: [{ items: [thread], nextCursor: 'next' }, undefined],
      error: undefined,
      isLoading: false,
      isValidating: true,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 2,
    };

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(result.current.items).toEqual([thread]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isLoadingMore).toBe(true);
  });

  it('exposes a tail error without turning it into an initial failure', () => {
    const error = new Error('next page failed');
    const thread = {
      replyCount: 0,
      root: { id: 'comment-1' },
    };
    mocks.infiniteResponse = {
      data: [{ items: [thread], nextCursor: 'next' }, undefined],
      error,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 2,
    };

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(result.current.items).toEqual([thread]);
    expect(result.current.isInitialError).toBe(false);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.hasMore).toBe(false);
  });

  it('marks a first-page failure as an initial error', () => {
    mocks.infiniteResponse = {
      data: undefined,
      error: new Error('first page failed'),
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };

    const { result } = renderHook(() => useTopicCommentThreads('topic-1'));

    expect(result.current.items).toEqual([]);
    expect(result.current.isInitialError).toBe(true);
  });
});
