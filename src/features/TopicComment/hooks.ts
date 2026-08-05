import type {
  CreateTopicCommentInput,
  TopicCommentItem,
  TopicCommentReplyPage,
  TopicCommentSummary,
  TopicCommentThreadPage,
  UpdateTopicCommentInput,
} from '@lobechat/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { unstable_serialize, useSWRConfig } from 'swr';
import type { ScopedMutator } from 'swr/_internal';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { topicCommentKeys } from '@/libs/swr/keys';
import { topicCommentService } from '@/services/topicComment';
import { useChatStore } from '@/store/chat';
import {
  createTopicCommentDraftKey,
  topicCommentSelectors,
  useTopicCommentStore,
} from '@/store/topicComment';
import type {
  OptimisticTopicCommentMutation,
  OptimisticTopicCommentReplyCountMutation,
} from '@/store/topicComment/initialState';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';
import { isTrpcErrorCode } from '@/utils/trpcError';

const PAGE_SIZE = 30;
const PREFETCH_CONCURRENCY = 4;
const EMPTY_TOPIC_COMMENT_THREAD_PAGES: TopicCommentThreadPage[] = [
  { items: [], nextCursor: null },
];
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

const fetchTopicCommentThreads = ([
  ,
  ,
  currentTopicId,
  currentMessageId,
  cursor,
]: readonly string[]) =>
  topicCommentService.listThreads({
    cursor: cursor || undefined,
    limit: PAGE_SIZE,
    messageId: currentMessageId || undefined,
    topicId: currentTopicId,
  });

const fetchTopicCommentReplies = ([, , currentRootCommentId, cursor]: readonly string[]) =>
  topicCommentService.listReplies({
    cursor: cursor || undefined,
    limit: PAGE_SIZE,
    rootCommentId: currentRootCommentId,
  });

const preloadTopicCommentThreads = (
  populateCache: ScopedMutator,
  workspaceId: string,
  topicId: string,
  messageId?: string,
) => {
  const key = topicCommentKeys.threads(workspaceId, topicId, messageId);
  return fetchTopicCommentThreads(key as readonly string[]).then(async (page) => {
    await populateCache(key, page, { revalidate: false });
    return page;
  });
};

const preloadTopicCommentReplies = (
  populateCache: ScopedMutator,
  workspaceId: string,
  rootCommentId: string,
) => {
  const key = topicCommentKeys.replies(workspaceId, rootCommentId);
  return fetchTopicCommentReplies(key as readonly string[]).then(async (page) => {
    await populateCache(key, page, { revalidate: false });
    return page;
  });
};

export const useTopicCommentSummary = (topicId?: string | null) => {
  const workspaceId = useActiveWorkspaceId();
  const pendingComments = useTopicCommentStore(
    topicCommentSelectors.summaryPendingComments(workspaceId, topicId),
  );
  const pendingDeletes = useTopicCommentStore(
    topicCommentSelectors.summaryPendingDeletes(workspaceId, topicId),
  );
  const pendingRestores = useTopicCommentStore(
    topicCommentSelectors.summaryPendingRestores(workspaceId, topicId),
  );
  const response = useClientDataSWR<TopicCommentSummary>(
    topicId ? topicCommentKeys.summary(topicId) : null,
    () => topicCommentService.summary(topicId!),
    { dedupingInterval: 30_000 },
  );
  const data = useMemo(() => {
    if (
      !response.data ||
      (pendingComments.length === 0 && pendingDeletes.length === 0 && pendingRestores.length === 0)
    )
      return response.data;

    const countByMessage = { ...response.data.countByMessage };
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
        response.data.total +
          pendingComments.length -
          pendingDeletes.length +
          pendingRestores.length,
      ),
    };
  }, [pendingComments, pendingDeletes, pendingRestores, response.data]);

  return { ...response, data };
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
  const optimisticMutation = useTopicCommentStore(
    topicCommentSelectors.optimisticMutation(commentId),
  );
  const response = useClientDataSWR(
    commentId ? topicCommentKeys.detail(commentId) : null,
    () => topicCommentService.get(commentId!),
    { fallbackData },
  );
  const isDeleting =
    optimisticMutation?.kind === 'delete' && optimisticMutation.deleteMode === 'hard';
  const isNotFound = isTrpcErrorCode(response.error, 'NOT_FOUND');

  return {
    ...response,
    data:
      isNotFound || (isDeleting && !optimisticMutation?.pending)
        ? undefined
        : (optimisticMutation?.comment ?? response.data),
    isDeleting,
  };
};

export const usePrefetchTopicCommentsOnTopicLoad = (topicId: string | null | undefined) => {
  const workspaceId = useActiveWorkspaceId();
  const { mutate: populateCache } = useSWRConfig();
  const topicParams = topicId && workspaceId ? { topicId, workspaceId } : undefined;

  useClientDataSWR(
    topicParams ? topicCommentKeys.warmup(topicParams.workspaceId, topicParams.topicId) : null,
    topicParams
      ? async () => {
          // Let the initial topic/message queries flush their tRPC batch first so this
          // background warmup starts immediately without delaying the primary payload.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const page = await preloadTopicCommentThreads(
            populateCache,
            topicParams.workspaceId,
            topicParams.topicId,
          );
          const rootCommentIds = page.items.flatMap(({ replyCount, root }) =>
            replyCount > 0 ? [root.id] : [],
          );
          for (let index = 0; index < rootCommentIds.length; index += PREFETCH_CONCURRENCY) {
            await Promise.all(
              rootCommentIds
                .slice(index, index + PREFETCH_CONCURRENCY)
                .map((rootCommentId) =>
                  preloadTopicCommentReplies(populateCache, topicParams.workspaceId, rootCommentId),
                ),
            );
          }
          return true;
        }
      : null,
    {
      revalidateOnFocus: false,
    },
  );
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
  const { cache } = useSWRConfig();
  const { data: summary } = useTopicCommentSummary(workspaceId ? topicId : undefined);
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
  const firstPageKey =
    topicId && workspaceId
      ? unstable_serialize(topicCommentKeys.threads(workspaceId, topicId, messageId))
      : undefined;
  const cachedFirstPage = firstPageKey
    ? (cache.get(firstPageKey)?.data as TopicCommentThreadPage | undefined)
    : undefined;
  const getKey = useCallback(
    (_index: number, previous: TopicCommentThreadPage | null) => {
      if (!topicId || !workspaceId || previous?.nextCursor === null) return null;
      return topicCommentKeys.threads(
        workspaceId,
        topicId,
        messageId,
        previous?.nextCursor ?? undefined,
      );
    },
    [messageId, topicId, workspaceId],
  );
  const response = useSWRInfinite<TopicCommentThreadPage>(getKey, fetchTopicCommentThreads, {
    fallbackData: isKnownEmpty
      ? EMPTY_TOPIC_COMMENT_THREAD_PAGES
      : cachedFirstPage
        ? [cachedFirstPage]
        : undefined,
    revalidateFirstPage: false,
    revalidateOnMount: true,
  });
  const data = response.data;
  useEffect(() => {
    if (!data || optimisticComments.length === 0) return;
    const remoteClientKeys = new Set(
      data.flatMap((page) => page?.items.map(({ root }) => topicCommentClientKey(root)) ?? []),
    );
    for (const { comment, targetKey } of optimisticComments) {
      if (remoteClientKeys.has(topicCommentClientKey(comment))) {
        removeOptimisticComment(targetKey, comment.clientId);
      }
    }
  }, [data, optimisticComments, removeOptimisticComment]);
  const remoteItems = data?.flatMap((page) => page?.items ?? []) ?? [];
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
  const lastPage = data?.findLast(Boolean);
  const hasLoadedPages = data !== undefined || optimisticComments.length > 0;
  const isInitialError = Boolean(response.error) && !hasLoadedPages;
  const isLoadingInitial = !response.error && response.isLoading && !hasLoadedPages;
  const isLoadingMore =
    !response.error &&
    hasLoadedPages &&
    response.size > 0 &&
    typeof data?.[response.size - 1] === 'undefined';

  return {
    ...response,
    hasMore: !response.error && (lastPage ? lastPage.nextCursor !== null : false),
    isInitialError,
    isLoadingInitial,
    isLoadingMore,
    isRetrying: Boolean(response.error) && response.isValidating,
    items,
    loadMore: () => response.setSize((size) => size + 1),
    pendingCommentIds,
    reload: response.mutate,
  };
};

export const useTopicCommentReplies = (
  rootCommentId?: string | null,
  initialReplyCount?: number,
) => {
  const workspaceId = useActiveWorkspaceId();
  const { cache } = useSWRConfig();
  const optimisticComments = useTopicCommentStore(
    topicCommentSelectors.optimisticReplies(workspaceId, rootCommentId),
  );
  const optimisticMutations = useTopicCommentStore(
    topicCommentSelectors.optimisticReplyMutations(workspaceId, rootCommentId),
  );
  const removeOptimisticComment = useTopicCommentStore((s) => s.removeOptimisticComment);
  const removeOptimisticMutation = useTopicCommentStore((s) => s.removeOptimisticMutation);
  const getKey = useCallback(
    (_index: number, previous: TopicCommentReplyPage | null) => {
      if (!rootCommentId || !workspaceId || previous?.nextCursor === null) return null;
      return topicCommentKeys.replies(
        workspaceId,
        rootCommentId,
        previous?.nextCursor ?? undefined,
      );
    },
    [rootCommentId, workspaceId],
  );
  const firstPageKey =
    rootCommentId && workspaceId
      ? unstable_serialize(topicCommentKeys.replies(workspaceId, rootCommentId))
      : undefined;
  const cachedFirstPage = firstPageKey
    ? (cache.get(firstPageKey)?.data as TopicCommentReplyPage | undefined)
    : undefined;
  const response = useSWRInfinite<TopicCommentReplyPage>(getKey, fetchTopicCommentReplies, {
    fallbackData:
      initialReplyCount === 0
        ? [{ items: [], nextCursor: null, total: 0 }]
        : cachedFirstPage
          ? [cachedFirstPage]
          : undefined,
    revalidateFirstPage: false,
    revalidateOnMount: true,
  });
  const data = response.data;
  useEffect(() => {
    if (!data || optimisticComments.length === 0) return;
    const remoteClientKeys = new Set(
      data.flatMap((page) => page?.items.map(topicCommentClientKey) ?? []),
    );
    for (const { comment, targetKey } of optimisticComments) {
      if (remoteClientKeys.has(topicCommentClientKey(comment))) {
        removeOptimisticComment(targetKey, comment.clientId);
      }
    }
  }, [data, optimisticComments, removeOptimisticComment]);
  const remoteItems = data?.flatMap((page) => page?.items ?? []) ?? [];
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
  const lastPage = data?.findLast(Boolean);
  const hasLoadedPages = data !== undefined || optimisticComments.length > 0;
  const isInitialError = Boolean(response.error) && !hasLoadedPages;
  const isLoadingInitial = !response.error && response.isLoading && !hasLoadedPages;
  const isLoadingMore =
    !response.error &&
    hasLoadedPages &&
    response.size > 0 &&
    typeof data?.[response.size - 1] === 'undefined';

  return {
    ...response,
    hasMore: !response.error && (lastPage ? lastPage.nextCursor !== null : false),
    isInitialError,
    isLoadingInitial,
    isLoadingMore,
    isRetrying: Boolean(response.error) && response.isValidating,
    items,
    loadMore: () => response.setSize((size) => size + 1),
    pendingCommentIds,
    reload: response.mutate,
    total: data?.[0]?.total,
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
            void mutate(
              topicCommentKeys.summary(input.topicId),
              (current: TopicCommentSummary | undefined) => {
                if (!current) return current;
                const countByMessage = { ...current.countByMessage };
                if (input.messageId) {
                  countByMessage[input.messageId] = (countByMessage[input.messageId] ?? 0) + 1;
                }
                return { countByMessage, total: current.total + 1 };
              },
              { revalidate: true },
            ).catch(() => undefined);
          } else {
            void mutate(topicCommentKeys.summary(input.topicId)).catch(() => undefined);
          }
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
      removeOptimisticComment,
      removeOptimisticReplyCountMutation,
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
          void mutate(topicCommentKeys.detail(result.id), result, { revalidate: false }).catch(
            () => undefined,
          );
          return result;
        } catch (error) {
          if (previousMutation) upsertOptimisticMutation(previousMutation);
          else removeOptimisticMutation(input.id);
          throw error;
        }
      }),
    [removeOptimisticMutation, runForId, upsertOptimisticMutation],
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
          void mutate(
            topicCommentKeys.summary(comment.topicId),
            (current: TopicCommentSummary | undefined) => {
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
            },
            { revalidate: true },
          ).catch(() => undefined);
          upsertOptimisticMutation({ ...confirmedMutation, pending: false });
          if (replyCountMutation) {
            upsertOptimisticReplyCountMutation({ ...replyCountMutation, pending: false });
          }
          void mutate(
            topicCommentKeys.detail(comment.id),
            result.mode === 'hard' ? undefined : confirmedMutation.comment,
            { revalidate: false },
          ).catch(() => undefined);
          return result;
        } catch (error) {
          if (previousMutation) upsertOptimisticMutation(previousMutation);
          else removeOptimisticMutation(comment.id);
          if (replyCountMutation) removeOptimisticReplyCountMutation(replyCountMutation.id);
          throw error;
        }
      }),
    [
      removeOptimisticMutation,
      removeOptimisticReplyCountMutation,
      runForId,
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
          void mutate(
            topicCommentKeys.summary(comment.topicId),
            (current: TopicCommentSummary | undefined) => {
              if (!current) return current;
              const countByMessage = { ...current.countByMessage };
              if (comment.messageId && options.rootReplyCount === 0) {
                countByMessage[comment.messageId] = (countByMessage[comment.messageId] ?? 0) + 1;
              }
              return { countByMessage, total: current.total + 1 };
            },
            { revalidate: true },
          ).catch(() => undefined);
          void mutate(topicCommentKeys.detail(comment.id), result, { revalidate: false }).catch(
            () => undefined,
          );
          return result;
        } catch (error) {
          if (previousMutation) upsertOptimisticMutation(previousMutation);
          else removeOptimisticMutation(comment.id);
          throw error;
        }
      }),
    [removeOptimisticMutation, runForId, upsertOptimisticMutation],
  );

  return { create, creating, mutatingIds, remove, restore, update };
};
