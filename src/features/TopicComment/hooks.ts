import type {
  CreateTopicCommentInput,
  TopicCommentItem,
  UpdateTopicCommentInput,
} from '@lobechat/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { topicCommentService } from '@/services/topicComment';
import { useChatStore } from '@/store/chat';
import {
  createTopicCommentDraftKey,
  TOPIC_COMMENT_PAGE_SIZE,
  topicCommentSelectors,
  topicCommentThreadsKey,
  useTopicCommentStore,
} from '@/store/topicComment';
import type {
  OptimisticTopicCommentMutation,
  OptimisticTopicCommentReplyCountMutation,
} from '@/store/topicComment/initialState';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';
import { isTrpcErrorCode } from '@/utils/trpcError';

/**
 * Topic comments are replicas: the feed of a topic, the replies of a root
 * comment, the per-topic counts and one comment by id each paint their
 * persisted copy on the first frame and are confirmed by the network in the
 * background. The hooks below read the store views and layer the client-only
 * optimistic overlays on top; `useSync` only orchestrates fetching.
 */

const topicCommentClientKey = ({
  authorUserId,
  clientId,
}: Pick<TopicCommentItem, 'authorUserId' | 'clientId'>) => `${authorUserId ?? ''}:${clientId}`;

const isOptimisticMutationReconciled = (
  mutation: OptimisticTopicCommentMutation,
  remoteComment: TopicCommentItem | undefined,
) => {
  if (mutation.pending) return false;
  if (mutation.kind === 'delete' && mutation.deleteMode === 'hard') return !remoteComment;
  if (!remoteComment) return false;
  if (mutation.kind === 'restore') return !remoteComment.moderatedAt;
  if (mutation.kind === 'delete')
    return mutation.deleteMode === 'soft'
      ? Boolean(remoteComment.deletedAt)
      : Boolean(remoteComment.moderatedAt);

  return (
    new Date(remoteComment.updatedAt).getTime() >= new Date(mutation.comment.updatedAt).getTime()
  );
};

const areReplyCountMutationsReconciled = (
  mutations: OptimisticTopicCommentReplyCountMutation[],
  remoteCount: number,
) => {
  if (mutations.length === 0 || mutations.some(({ pending }) => pending)) return false;
  const baselineCount = mutations[0].baselineCount;
  const lastMutation = mutations.at(-1)!;
  const targetCount = Math.max(0, lastMutation.baselineCount + lastMutation.delta);
  if (targetCount === baselineCount) return true;
  return targetCount > baselineCount ? remoteCount >= targetCount : remoteCount <= targetCount;
};

const resolveReplyCount = (
  remoteCount: number,
  mutations: OptimisticTopicCommentReplyCountMutation[],
) => {
  if (mutations.length === 0) return remoteCount;
  if (areReplyCountMutationsReconciled(mutations, remoteCount)) return remoteCount;
  const lastMutation = mutations.at(-1)!;
  return Math.max(0, lastMutation.baselineCount + lastMutation.delta);
};

export const useTopicCommentSummary = (topicId?: string | null) => {
  const workspaceId = useActiveWorkspaceId();
  const useFetchSummary = useTopicCommentStore((s) => s.useFetchTopicCommentSummary);
  const sync = useFetchSummary(topicId);
  const stored = useTopicCommentStore((s) => (topicId ? s.commentSummaryMap[topicId] : undefined));
  const pendingComments = useTopicCommentStore(
    topicCommentSelectors.summaryPendingComments(workspaceId, topicId),
  );
  const pendingDeletes = useTopicCommentStore(
    topicCommentSelectors.summaryPendingDeletes(workspaceId, topicId),
  );
  const pendingRestores = useTopicCommentStore(
    topicCommentSelectors.summaryPendingRestores(workspaceId, topicId),
  );
  const data = useMemo(() => {
    if (
      !stored ||
      (pendingComments.length === 0 && pendingDeletes.length === 0 && pendingRestores.length === 0)
    )
      return stored;

    const countByMessage = { ...stored.countByMessage };
    for (const { comment } of pendingComments) {
      if (comment.messageId)
        countByMessage[comment.messageId] = (countByMessage[comment.messageId] ?? 0) + 1;
    }
    for (const { affectsMessageCount, comment } of pendingDeletes) {
      if (affectsMessageCount && comment.messageId) {
        const nextCount = Math.max(0, (countByMessage[comment.messageId] ?? 0) - 1);
        if (nextCount === 0) delete countByMessage[comment.messageId];
        else countByMessage[comment.messageId] = nextCount;
      }
    }
    for (const { affectsMessageCount, comment } of pendingRestores) {
      if (affectsMessageCount && comment.messageId)
        countByMessage[comment.messageId] = (countByMessage[comment.messageId] ?? 0) + 1;
    }

    return {
      countByMessage,
      total: Math.max(
        0,
        stored.total + pendingComments.length - pendingDeletes.length + pendingRestores.length,
      ),
    };
  }, [pendingComments, pendingDeletes, pendingRestores, stored]);

  return { ...sync, data };
};

export const useMessageCommentCount = (messageId: string) => {
  const workspaceId = useActiveWorkspaceId();
  const topicId = useChatStore((s) => s.activeTopicId);
  const { data } = useTopicCommentSummary(workspaceId ? topicId : undefined);

  return {
    count: data?.countByMessage[messageId] ?? 0,
    topicId: workspaceId ? topicId : null,
  };
};

export const useTopicCommentDetail = (
  commentId?: string | null,
  fallbackData?: TopicCommentItem,
) => {
  const useFetchDetail = useTopicCommentStore((s) => s.useFetchTopicCommentDetail);
  const revalidateDetail = useTopicCommentStore((s) => s.revalidateTopicCommentDetail);
  const sync = useFetchDetail(commentId);
  const stored = useTopicCommentStore((s) =>
    commentId ? s.commentDetailMap[commentId] : undefined,
  );
  const optimisticMutation = useTopicCommentStore(
    topicCommentSelectors.optimisticMutation(commentId),
  );
  const isDeleting =
    optimisticMutation?.kind === 'delete' && optimisticMutation.deleteMode === 'hard';
  const isNotFound = isTrpcErrorCode(sync.error, 'NOT_FOUND');
  const data =
    isNotFound || (isDeleting && !optimisticMutation?.pending)
      ? undefined
      : (optimisticMutation?.comment ?? stored ?? fallbackData);
  const mutate = useCallback(
    () => (commentId ? revalidateDetail(commentId) : Promise.resolve()),
    [commentId, revalidateDetail],
  );

  return {
    data,
    error: sync.error,
    isDeleting,
    // A validating sync with nothing to show for it is the loading state.
    isLoading: sync.isValidating && data === undefined,
    isValidating: sync.isValidating,
    mutate,
  };
};

export const usePrefetchTopicCommentsOnTopicLoad = (topicId: string | null | undefined) => {
  const workspaceId = useActiveWorkspaceId();
  const prefetchTopicComments = useTopicCommentStore((s) => s.prefetchTopicComments);

  useEffect(() => {
    if (!topicId || !workspaceId) return;
    // Let the initial topic/message queries flush their tRPC batch first so this
    // background warmup starts immediately without delaying the primary payload.
    const timer = setTimeout(() => void prefetchTopicComments(topicId), 0);
    return () => clearTimeout(timer);
  }, [prefetchTopicComments, topicId, workspaceId]);
};

export const useTopicCommentReplyCount = (
  rootCommentId: string | null | undefined,
  remoteCount: number,
) => {
  const mutations = useTopicCommentStore(
    topicCommentSelectors.optimisticReplyCountMutations(rootCommentId),
  );
  const removeOptimisticReplyCountMutation = useTopicCommentStore(
    (s) => s.removeOptimisticReplyCountMutation,
  );
  useEffect(() => {
    if (!areReplyCountMutationsReconciled(mutations, remoteCount)) return;
    for (const mutation of mutations) {
      removeOptimisticReplyCountMutation(mutation.id);
    }
  }, [mutations, remoteCount, removeOptimisticReplyCountMutation]);

  return useMemo(() => resolveReplyCount(remoteCount, mutations), [mutations, remoteCount]);
};

export const useTopicCommentThreads = (topicId?: string | null, messageId?: string) => {
  const workspaceId = useActiveWorkspaceId();
  const useFetchThreads = useTopicCommentStore((s) => s.useFetchTopicCommentThreads);
  const loadMoreThreads = useTopicCommentStore((s) => s.loadMoreTopicCommentThreads);
  const revalidateThreads = useTopicCommentStore((s) => s.revalidateTopicCommentThreads);
  const { data: summary } = useTopicCommentSummary(workspaceId ? topicId : undefined);
  const feed = useTopicCommentStore((s) =>
    topicId ? s.threadFeedMap[topicCommentThreadsKey({ messageId, topicId })] : undefined,
  );
  const optimisticComments = useTopicCommentStore(
    topicCommentSelectors.optimisticThreads(workspaceId, topicId, messageId),
  );
  const optimisticMutations = useTopicCommentStore(
    topicCommentSelectors.optimisticThreadMutations(workspaceId, topicId, messageId),
  );
  const optimisticReplyCountMutations = useTopicCommentStore(
    topicCommentSelectors.optimisticReplyCountMutationsByTopic(workspaceId, topicId),
  );
  const removeOptimisticComment = useTopicCommentStore((s) => s.removeOptimisticComment);
  const removeOptimisticMutation = useTopicCommentStore((s) => s.removeOptimisticMutation);
  const removeOptimisticReplyCountMutation = useTopicCommentStore(
    (s) => s.removeOptimisticReplyCountMutation,
  );
  const isKnownEmpty = Boolean(
    summary && (messageId ? (summary.countByMessage[messageId] ?? 0) === 0 : summary.total === 0),
  );
  const active = Boolean(topicId && workspaceId);
  const params = useMemo(
    () => (active ? { messageId, pageSize: TOPIC_COMMENT_PAGE_SIZE, topicId: topicId! } : null),
    [active, messageId, topicId],
  );
  const sync = useFetchThreads(params);

  const data = feed;
  useEffect(() => {
    if (!data || optimisticComments.length === 0) return;
    const remoteClientKeys = new Set(data.items.map(({ root }) => topicCommentClientKey(root)));
    for (const { comment, targetKey } of optimisticComments) {
      if (remoteClientKeys.has(topicCommentClientKey(comment))) {
        removeOptimisticComment(targetKey, comment.clientId);
      }
    }
  }, [data, optimisticComments, removeOptimisticComment]);
  const remoteItems = data?.items ?? [];
  useEffect(() => {
    if (!data || optimisticMutations.length === 0) return;
    const remoteById = new Map(remoteItems.map(({ root }) => [root.id, root]));
    for (const mutation of optimisticMutations) {
      if (isOptimisticMutationReconciled(mutation, remoteById.get(mutation.comment.id))) {
        removeOptimisticMutation(mutation.comment.id);
      }
    }
  }, [optimisticMutations, remoteItems, removeOptimisticMutation]);
  useEffect(() => {
    if (!data || optimisticReplyCountMutations.length === 0) return;
    const remoteCountByRootId = new Map(
      remoteItems.map(({ replyCount, root }) => [root.id, replyCount]),
    );
    const mutationsByRootId = new Map<string, OptimisticTopicCommentReplyCountMutation[]>();
    for (const mutation of optimisticReplyCountMutations) {
      const mutations = mutationsByRootId.get(mutation.rootCommentId) ?? [];
      mutations.push(mutation);
      mutationsByRootId.set(mutation.rootCommentId, mutations);
    }
    for (const [rootCommentId, mutations] of mutationsByRootId) {
      const remoteCount = remoteCountByRootId.get(rootCommentId);
      if (remoteCount !== undefined && areReplyCountMutationsReconciled(mutations, remoteCount)) {
        for (const mutation of mutations) removeOptimisticReplyCountMutation(mutation.id);
      }
    }
  }, [data, optimisticReplyCountMutations, remoteItems, removeOptimisticReplyCountMutation]);
  const remoteClientKeys = new Set(remoteItems.map(({ root }) => topicCommentClientKey(root)));
  const mutationById = new Map(
    optimisticMutations.map((mutation) => [mutation.comment.id, mutation]),
  );
  const items = [
    ...optimisticComments
      .filter(({ comment }) => !remoteClientKeys.has(topicCommentClientKey(comment)))
      .flatMap(({ comment }) => {
        const mutation = mutationById.get(comment.id);
        if (mutation?.kind === 'delete' && mutation.deleteMode === 'hard') return [];
        return [
          {
            replyCount: resolveReplyCount(
              0,
              optimisticReplyCountMutations.filter(
                ({ rootCommentId }) => rootCommentId === comment.id,
              ),
            ),
            root: mutation?.comment ?? comment,
          },
        ];
      }),
    ...remoteItems.flatMap((thread) => {
      const mutation = mutationById.get(thread.root.id);
      if (mutation?.kind === 'delete' && mutation.deleteMode === 'hard') return [];
      return [
        {
          ...thread,
          replyCount: resolveReplyCount(
            thread.replyCount,
            optimisticReplyCountMutations.filter(
              ({ rootCommentId }) => rootCommentId === thread.root.id,
            ),
          ),
          root: mutation?.comment ?? thread.root,
        },
      ];
    }),
  ];
  const pendingCommentIds = new Set(
    optimisticComments.filter(({ pending }) => pending).map(({ comment }) => comment.id),
  );
  const hasLoadedPages = data !== undefined || optimisticComments.length > 0 || isKnownEmpty;
  const error = sync.error ?? data?.loadMoreError;
  const isInitialError = Boolean(sync.error) && !hasLoadedPages;
  const isLoadingInitial = !sync.error && sync.isValidating && !hasLoadedPages;
  const isLoadingMore = !sync.error && (data?.isLoadingMore ?? false);
  const hasTailError = Boolean(data?.loadMoreError);
  const loadMore = useCallback(
    () => (params ? loadMoreThreads(params) : Promise.resolve()),
    [loadMoreThreads, params],
  );
  const reload = useCallback(() => {
    if (!params) return Promise.resolve();
    // A failed cursor request is retried with its own cursor: a head-only
    // revalidation cannot reach the page that failed.
    return hasTailError ? loadMoreThreads(params) : revalidateThreads(params);
  }, [hasTailError, loadMoreThreads, params, revalidateThreads]);

  return {
    error,
    hasMore: !error && (data?.hasMore ?? false),
    isInitialError,
    isLoadingInitial,
    isLoadingMore,
    isRetrying: Boolean(error) && (sync.isValidating || Boolean(data?.isLoadingMore)),
    items,
    loadMore,
    pendingCommentIds,
    reload,
  };
};

export const useTopicCommentReplies = (
  rootCommentId?: string | null,
  initialReplyCount?: number,
) => {
  const workspaceId = useActiveWorkspaceId();
  const useFetchReplies = useTopicCommentStore((s) => s.useFetchTopicCommentReplies);
  const loadMoreReplies = useTopicCommentStore((s) => s.loadMoreTopicCommentReplies);
  const revalidateReplies = useTopicCommentStore((s) => s.revalidateTopicCommentReplies);
  const feed = useTopicCommentStore((s) =>
    rootCommentId ? s.replyFeedMap[rootCommentId] : undefined,
  );
  const optimisticComments = useTopicCommentStore(
    topicCommentSelectors.optimisticReplies(workspaceId, rootCommentId),
  );
  const optimisticMutations = useTopicCommentStore(
    topicCommentSelectors.optimisticReplyMutations(workspaceId, rootCommentId),
  );
  const removeOptimisticComment = useTopicCommentStore((s) => s.removeOptimisticComment);
  const removeOptimisticMutation = useTopicCommentStore((s) => s.removeOptimisticMutation);
  const active = Boolean(rootCommentId && workspaceId);
  const params = useMemo(
    () => (active ? { pageSize: TOPIC_COMMENT_PAGE_SIZE, rootCommentId: rootCommentId! } : null),
    [active, rootCommentId],
  );
  const sync = useFetchReplies(params);

  const data = feed;
  useEffect(() => {
    if (!data || optimisticComments.length === 0) return;
    const remoteClientKeys = new Set(data.items.map(topicCommentClientKey));
    for (const { comment, targetKey } of optimisticComments) {
      if (remoteClientKeys.has(topicCommentClientKey(comment))) {
        removeOptimisticComment(targetKey, comment.clientId);
      }
    }
  }, [data, optimisticComments, removeOptimisticComment]);
  const remoteItems = data?.items ?? [];
  useEffect(() => {
    if (!data || optimisticMutations.length === 0) return;
    const remoteById = new Map(remoteItems.map((comment) => [comment.id, comment]));
    for (const mutation of optimisticMutations) {
      if (isOptimisticMutationReconciled(mutation, remoteById.get(mutation.comment.id))) {
        removeOptimisticMutation(mutation.comment.id);
      }
    }
  }, [optimisticMutations, remoteItems, removeOptimisticMutation]);
  const remoteClientKeys = new Set(remoteItems.map(topicCommentClientKey));
  const mutationById = new Map(
    optimisticMutations.map((mutation) => [mutation.comment.id, mutation]),
  );
  const items = [
    ...remoteItems.flatMap((comment) => {
      const mutation = mutationById.get(comment.id);
      if (mutation?.kind === 'delete' && mutation.deleteMode === 'hard') return [];
      return [mutation?.comment ?? comment];
    }),
    ...optimisticComments
      .filter(({ comment }) => !remoteClientKeys.has(topicCommentClientKey(comment)))
      .flatMap(({ comment }) => {
        const mutation = mutationById.get(comment.id);
        if (mutation?.kind === 'delete' && mutation.deleteMode === 'hard') return [];
        return [mutation?.comment ?? comment];
      }),
  ];
  const pendingCommentIds = new Set(
    optimisticComments.filter(({ pending }) => pending).map(({ comment }) => comment.id),
  );
  const hasLoadedPages = data !== undefined || optimisticComments.length > 0;
  const error = sync.error ?? data?.loadMoreError;
  const isInitialError = Boolean(sync.error) && !hasLoadedPages;
  const isLoadingInitial = !sync.error && sync.isValidating && !hasLoadedPages;
  const isLoadingMore = !sync.error && (data?.isLoadingMore ?? false);
  const hasTailError = Boolean(data?.loadMoreError);
  const loadMore = useCallback(
    () => (params ? loadMoreReplies(params) : Promise.resolve()),
    [loadMoreReplies, params],
  );
  const reload = useCallback(() => {
    if (!params) return Promise.resolve();
    // A failed cursor request is retried with its own cursor: a head-only
    // revalidation cannot reach the page that failed.
    return hasTailError ? loadMoreReplies(params) : revalidateReplies(params);
  }, [hasTailError, loadMoreReplies, params, revalidateReplies]);

  return {
    error,
    hasMore: !error && (data?.hasMore ?? false),
    isInitialError,
    isLoadingInitial,
    isLoadingMore,
    isRetrying: Boolean(error) && (sync.isValidating || Boolean(data?.isLoadingMore)),
    items,
    loadMore,
    pendingCommentIds,
    reload,
    total: data?.total ?? (initialReplyCount === 0 ? 0 : undefined),
  };
};

export const useTopicCommentMutations = () => {
  const workspaceId = useActiveWorkspaceId();
  const user = useUserStore(userProfileSelectors.userProfile);
  const [removeOptimisticMutation, upsertOptimisticMutation] = useTopicCommentStore((s) => [
    s.removeOptimisticMutation,
    s.upsertOptimisticMutation,
  ]);
  const [removeOptimisticReplyCountMutation, upsertOptimisticReplyCountMutation] =
    useTopicCommentStore((s) => [
      s.removeOptimisticReplyCountMutation,
      s.upsertOptimisticReplyCountMutation,
    ]);
  const [removeOptimisticComment, upsertOptimisticComment] = useTopicCommentStore((s) => [
    s.removeOptimisticComment,
    s.upsertOptimisticComment,
  ]);
  const [applySummary, revalidateSummary, upsertDetail, removeDetail] = useTopicCommentStore(
    (s) => [
      s.applyTopicCommentSummary,
      s.revalidateTopicCommentSummary,
      s.upsertTopicCommentDetail,
      s.removeTopicCommentDetail,
    ],
  );
  const [creating, setCreating] = useState(false);
  const [mutatingIds, setMutatingIds] = useState<ReadonlySet<string>>(new Set());

  const create = useCallback(
    async (input: CreateTopicCommentInput, options: { rootReplyCount?: number } = {}) => {
      setCreating(true);
      const targetKey = workspaceId
        ? createTopicCommentDraftKey({
            messageId: input.messageId,
            parentCommentId: input.parentCommentId,
            topicId: input.topicId,
            workspaceId,
          })
        : undefined;
      const now = new Date();
      const optimisticComment: TopicCommentItem | undefined =
        targetKey && user && workspaceId
          ? {
              anchorPreview: null,
              author: {
                avatar: user.avatar ?? null,
                fullName: user.fullName ?? null,
                id: user.id,
                status: 'active',
                username: user.username ?? null,
              },
              authorUserId: user.id,
              canDelete: false,
              canEdit: false,
              canRestore: false,
              clientId: input.clientId,
              content: input.content,
              createdAt: now,
              deletedAt: null,
              editorData: input.editorData ?? null,
              id: `optimistic-topic-comment-${input.clientId}`,
              messageId: input.messageId ?? null,
              moderatedAt: null,
              moderationExpiresAt: null,
              moderationIsOwn: false,
              parentCommentId: input.parentCommentId ?? null,
              topicId: input.topicId,
              updatedAt: now,
              workspaceId,
            }
          : undefined;

      if (targetKey && optimisticComment) {
        upsertOptimisticComment({
          comment: optimisticComment,
          pending: true,
          targetKey,
        });
      }
      const replyCountMutation =
        input.parentCommentId && workspaceId && options.rootReplyCount !== undefined
          ? {
              baselineCount: options.rootReplyCount,
              delta: 1 as const,
              id: input.clientId,
              pending: true,
              rootCommentId: input.parentCommentId,
              topicId: input.topicId,
              workspaceId,
            }
          : undefined;
      if (replyCountMutation) upsertOptimisticReplyCountMutation(replyCountMutation);

      try {
        const result = await topicCommentService.create(input);
        if (targetKey && optimisticComment) {
          if (!result.isDuplicate) {
            applySummary(input.topicId, (current) => {
              if (!current) return current;
              const countByMessage = { ...current.countByMessage };
              if (input.messageId) {
                countByMessage[input.messageId] = (countByMessage[input.messageId] ?? 0) + 1;
              }
              return { countByMessage, total: current.total + 1 };
            });
          }
          void revalidateSummary(input.topicId).catch(() => undefined);
          upsertOptimisticComment({
            comment: result.comment,
            pending: false,
            targetKey,
          });
        }
        if (replyCountMutation) {
          if (result.isDuplicate) removeOptimisticReplyCountMutation(replyCountMutation.id);
          else upsertOptimisticReplyCountMutation({ ...replyCountMutation, pending: false });
        }
        return result;
      } catch (error) {
        if (targetKey) removeOptimisticComment(targetKey, input.clientId);
        if (replyCountMutation) removeOptimisticReplyCountMutation(replyCountMutation.id);
        throw error;
      } finally {
        setCreating(false);
      }
    },
    [
      applySummary,
      removeOptimisticComment,
      removeOptimisticReplyCountMutation,
      revalidateSummary,
      upsertOptimisticComment,
      upsertOptimisticReplyCountMutation,
      user,
      workspaceId,
    ],
  );

  const runForId = useCallback(async <T>(id: string, action: () => Promise<T>) => {
    setMutatingIds((current) => new Set(current).add(id));
    try {
      return await action();
    } finally {
      setMutatingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const update = useCallback(
    (input: UpdateTopicCommentInput, currentComment: TopicCommentItem) =>
      runForId(input.id, async () => {
        const previousMutation = useTopicCommentStore.getState().optimisticMutations[input.id];
        const optimisticComment: TopicCommentItem = {
          ...currentComment,
          content: input.content ?? currentComment.content,
          editorData: input.editorData ?? currentComment.editorData,
          updatedAt: new Date(),
        };
        upsertOptimisticMutation({
          comment: optimisticComment,
          kind: 'update',
          pending: true,
        });

        try {
          const result = await topicCommentService.update(input);
          upsertOptimisticMutation({ comment: result, kind: 'update', pending: false });
          upsertDetail(result);
          return result;
        } catch (error) {
          if (previousMutation) upsertOptimisticMutation(previousMutation);
          else removeOptimisticMutation(input.id);
          throw error;
        }
      }),
    [removeOptimisticMutation, runForId, upsertDetail, upsertOptimisticMutation],
  );
  const remove = useCallback(
    (
      comment: TopicCommentItem,
      optimisticDeleteMode: 'hard' | 'soft' = 'hard',
      options: { rootReplyCount?: number } = {},
    ) =>
      runForId(comment.id, async () => {
        const previousMutation = useTopicCommentStore.getState().optimisticMutations[comment.id];
        const createDeletedComment = (mode: 'hard' | 'moderated' | 'soft'): TopicCommentItem =>
          mode === 'moderated'
            ? {
                ...comment,
                canDelete: false,
                canEdit: false,
                canRestore: true,
                moderatedAt: new Date(),
                moderationExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                moderationIsOwn: false,
              }
            : mode === 'soft'
              ? {
                  ...comment,
                  canDelete: false,
                  canEdit: false,
                  canRestore: false,
                  content: '',
                  deletedAt: new Date(),
                  editorData: null,
                  updatedAt: new Date(),
                }
              : comment;
        const initialDeleteMode =
          comment.canDelete && !comment.canEdit ? 'moderated' : optimisticDeleteMode;
        upsertOptimisticMutation({
          affectsMessageCount: optimisticDeleteMode === 'hard',
          comment: createDeletedComment(initialDeleteMode),
          deleteMode: initialDeleteMode,
          kind: 'delete',
          pending: true,
        });
        const replyCountMutation =
          comment.parentCommentId && workspaceId && options.rootReplyCount !== undefined
            ? {
                baselineCount: options.rootReplyCount,
                delta: -1 as const,
                id: `delete:${comment.id}`,
                pending: true,
                rootCommentId: comment.parentCommentId,
                topicId: comment.topicId,
                workspaceId,
              }
            : undefined;
        if (replyCountMutation) upsertOptimisticReplyCountMutation(replyCountMutation);

        try {
          const result = await topicCommentService.delete(comment.id);
          const confirmedMutation: OptimisticTopicCommentMutation = {
            affectsMessageCount: optimisticDeleteMode === 'hard',
            comment:
              result.mode === 'moderated' ? result.comment : createDeletedComment(result.mode),
            deleteMode: result.mode,
            kind: 'delete',
            pending: true,
          };
          upsertOptimisticMutation(confirmedMutation);
          applySummary(comment.topicId, (current) => {
            if (!current) return current;
            const countByMessage = { ...current.countByMessage };
            const removesMessageCount =
              result.mode === 'hard' ||
              (result.mode === 'moderated' && optimisticDeleteMode === 'hard');
            if (removesMessageCount && comment.messageId) {
              const nextCount = Math.max(0, (countByMessage[comment.messageId] ?? 0) - 1);
              if (nextCount > 0) countByMessage[comment.messageId] = nextCount;
              else delete countByMessage[comment.messageId];
            }
            return { countByMessage, total: Math.max(0, current.total - 1) };
          });
          void revalidateSummary(comment.topicId).catch(() => undefined);
          upsertOptimisticMutation({ ...confirmedMutation, pending: false });
          if (replyCountMutation) {
            upsertOptimisticReplyCountMutation({ ...replyCountMutation, pending: false });
          }
          if (result.mode === 'hard') removeDetail(comment.id);
          else upsertDetail(confirmedMutation.comment);
          return result;
        } catch (error) {
          if (previousMutation) upsertOptimisticMutation(previousMutation);
          else removeOptimisticMutation(comment.id);
          if (replyCountMutation) removeOptimisticReplyCountMutation(replyCountMutation.id);
          throw error;
        }
      }),
    [
      applySummary,
      removeDetail,
      removeOptimisticMutation,
      removeOptimisticReplyCountMutation,
      revalidateSummary,
      runForId,
      upsertDetail,
      upsertOptimisticMutation,
      upsertOptimisticReplyCountMutation,
      workspaceId,
    ],
  );

  const restore = useCallback(
    (comment: TopicCommentItem, options: { rootReplyCount?: number } = {}) =>
      runForId(comment.id, async () => {
        const previousMutation = useTopicCommentStore.getState().optimisticMutations[comment.id];
        const optimisticComment: TopicCommentItem = {
          ...comment,
          canDelete: true,
          canRestore: false,
          moderatedAt: null,
          moderationExpiresAt: null,
          moderationIsOwn: false,
        };
        upsertOptimisticMutation({
          affectsMessageCount: options.rootReplyCount === 0,
          comment: optimisticComment,
          kind: 'restore',
          pending: true,
        });

        try {
          const result = await topicCommentService.restore(comment.id);
          upsertOptimisticMutation({
            affectsMessageCount: options.rootReplyCount === 0,
            comment: result,
            kind: 'restore',
            pending: false,
          });
          applySummary(comment.topicId, (current) => {
            if (!current) return current;
            const countByMessage = { ...current.countByMessage };
            if (comment.messageId && options.rootReplyCount === 0) {
              countByMessage[comment.messageId] = (countByMessage[comment.messageId] ?? 0) + 1;
            }
            return { countByMessage, total: current.total + 1 };
          });
          void revalidateSummary(comment.topicId).catch(() => undefined);
          upsertDetail(result);
          return result;
        } catch (error) {
          if (previousMutation) upsertOptimisticMutation(previousMutation);
          else removeOptimisticMutation(comment.id);
          throw error;
        }
      }),
    [
      applySummary,
      removeOptimisticMutation,
      revalidateSummary,
      runForId,
      upsertDetail,
      upsertOptimisticMutation,
    ],
  );

  return { create, creating, mutatingIds, remove, restore, update };
};
