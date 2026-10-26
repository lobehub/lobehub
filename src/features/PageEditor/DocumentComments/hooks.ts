import type { DocumentCommentItem, DocumentCommentSelectionAnchor } from '@lobechat/types';
import { useCallback, useEffect, useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import type { ReplicaPagedData } from '@/libs/replica';
import {
  documentCommentActions,
  documentCommentSelectors,
  type DocumentCommentThreadScope,
  useDocumentCommentStore,
} from '@/store/documentComment';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  createOptimisticComment,
  type DocumentCommentUpdateHandler,
  flattenDocumentCommentReplies,
  flattenDocumentCommentThreads,
} from './optimistic';

export type { DocumentCommentThreadScope } from '@/store/documentComment';

/**
 * Paging flags of a replica feed. The feed entry is the data: `undefined`
 * means nothing has painted yet (neither the persisted copy nor the network),
 * which is the only state that shows a loading placeholder.
 */
export const getFeedPaginationState = (
  feed: ReplicaPagedData<unknown, string> | undefined,
  { enabled, error, isValidating }: { enabled: boolean; error: unknown; isValidating: boolean },
) => {
  const hasError = Boolean(error);
  return {
    hasMore: !hasError && Boolean(feed?.hasMore),
    isInitialError: hasError && !feed,
    isLoadingInitial: enabled && !hasError && !feed,
    isLoadingMore: !hasError && Boolean(feed?.isLoadingMore),
    isRetrying: hasError && isValidating,
  };
};

export const useDocumentCommentSummary = (documentId?: string | null) => {
  const sync = documentCommentActions.useFetchSummary(documentId);
  const data = useDocumentCommentStore(documentCommentSelectors.summary(documentId));
  return { data, error: sync.error, isLoading: Boolean(documentId) && !data && !sync.error };
};

/**
 * One comment by id. Lists are oldest-first and a notification usually points
 * at the newest comment, so a deep link fetches its target directly instead of
 * paging towards it; `isNotFound` means the comment is gone.
 */
export const useDocumentCommentDetail = (commentId?: string | null) => {
  const workspaceId = useActiveWorkspaceId();
  const enabledId = workspaceId ? commentId : undefined;
  const sync = documentCommentActions.useFetchDetail(enabledId);
  const data = useDocumentCommentStore(documentCommentSelectors.detail(enabledId));

  return {
    data,
    error: sync.error,
    isNotFound: isTrpcErrorCode(sync.error, 'NOT_FOUND'),
    revalidate: sync.revalidate,
  };
};

/** Edits go through the store, which patches every painted copy of the comment. */
export const handleDocumentCommentUpdate: DocumentCommentUpdateHandler = async (comment, value) => {
  await documentCommentActions.updateComment(comment, value);
};

export const useOptimisticDocumentComment = () => {
  const workspaceId = useActiveWorkspaceId();
  const user = useUserStore(userProfileSelectors.userProfile);

  return useCallback(
    ({
      clientId,
      content,
      documentId,
      editorData,
      parentCommentId,
      replyTo,
      selectionAnchor,
    }: {
      clientId: string;
      content: string;
      documentId: string;
      editorData: DocumentCommentItem['editorData'];
      parentCommentId?: string;
      replyTo?: DocumentCommentItem['replyTo'];
      selectionAnchor?: DocumentCommentSelectionAnchor;
    }) => {
      if (!workspaceId) throw new Error('Workspace is required for document comments');

      return createOptimisticComment({
        author: {
          avatar: user?.avatar ?? null,
          fullName: user?.fullName ?? null,
          id: user?.id ?? null,
          status: 'active',
          username: user?.username ?? null,
        },
        clientId,
        content,
        documentId,
        editorData,
        parentCommentId,
        replyTo,
        selectionAnchor,
        userId: user?.id ?? null,
        workspaceId,
      });
    },
    [user?.avatar, user?.fullName, user?.id, user?.username, workspaceId],
  );
};

/**
 * Every anchored root of the document, independent of how many thread pages
 * the list has loaded. Body highlights are painted from this so a
 * newer anchored comment is discoverable from the document right after a
 * reload, not only once the reader has paged the list far enough to reach it.
 */
export const useDocumentCommentAnchorList = (documentId?: string | null) => {
  const workspaceId = useActiveWorkspaceId();
  const enabledId = workspaceId ? documentId : undefined;
  documentCommentActions.useFetchAnchors(enabledId);
  return useDocumentCommentStore(documentCommentSelectors.anchorList(enabledId));
};

/**
 * How many pages of anchored threads the gutter fetches ahead of demand while
 * it is open, so the cards beside the text are there for the runs a reader
 * is most likely looking at. Anything past it stays paginated: a highlight
 * whose thread is not loaded is still painted (from the anchor list) and
 * fetches its own thread on pick, and the list below the body pages the rest.
 */
export const ANCHORED_EAGER_PAGE_LIMIT = 4;

/** Whether the eager drain should ask for the next page now. */
export const shouldLoadEagerPage = (
  feed: ReplicaPagedData<unknown, string> | undefined,
  limit: number,
) =>
  Boolean(feed) &&
  feed!.hasMore &&
  !feed!.isLoadingMore &&
  // A failed page stops the drain; the reader retries it explicitly.
  !feed!.loadMoreError &&
  feed!.currentPage + 1 < limit;

export const useDocumentCommentThreads = (
  documentId?: string | null,
  scope: DocumentCommentThreadScope = 'all',
  {
    eagerPageLimit = 0,
  }: {
    /**
     * Pages to fetch ahead of demand, one after another, without the reader
     * asking; `0` (the default) leaves paging entirely to `loadMore`.
     */
    eagerPageLimit?: number;
  } = {},
) => {
  const workspaceId = useActiveWorkspaceId();
  const params = useMemo(
    () => (documentId && workspaceId ? { documentId, scope } : null),
    [documentId, scope, workspaceId],
  );
  const sync = documentCommentActions.useFetchThreads(params);
  const feed = useDocumentCommentStore(documentCommentSelectors.threadFeed(params));
  // A head refresh failure, or a failed "load more" page.
  const error = (sync.error ?? feed?.loadMoreError) as Error | undefined;
  const pagination = getFeedPaginationState(feed, {
    enabled: Boolean(params),
    error,
    isValidating: sync.isValidating,
  });

  // Fetch ahead of demand up to the caller's budget: for the gutter, a card
  // it has not loaded is a highlight with nothing beside it. The budget keeps
  // a document with hundreds of anchored roots from mounting every one of
  // them (twice — gutter and list) before the reader has looked at any. A
  // feed painted from storage does not page until the network confirms its
  // head (its cursor may be stale); the confirmed head re-runs this.
  useEffect(() => {
    if (!params || !shouldLoadEagerPage(feed, eagerPageLimit)) return;
    void documentCommentActions.loadMoreThreads(params);
  }, [eagerPageLimit, feed, params]);

  const items = useMemo(() => flattenDocumentCommentThreads(feed?.items), [feed?.items]);
  const loadMore = useCallback(
    () => (params ? documentCommentActions.loadMoreThreads(params) : Promise.resolve()),
    [params],
  );
  const reload = useCallback(
    () => (params ? documentCommentActions.revalidateThreads(params) : Promise.resolve()),
    [params],
  );

  return {
    ...pagination,
    error,
    isValidating: sync.isValidating,
    items,
    loadMore,
    reload,
  };
};

export const useDocumentCommentReplies = (
  rootCommentId: string | null | undefined,
  enabled: boolean,
) => {
  const workspaceId = useActiveWorkspaceId();
  const enabledId = workspaceId ? rootCommentId : undefined;
  const sync = documentCommentActions.useFetchReplies(enabledId, enabled);
  const feed = useDocumentCommentStore(
    documentCommentSelectors.replyFeed(enabled ? enabledId : undefined),
  );
  // A head refresh failure, or a failed "load more" page.
  const error = (sync.error ?? feed?.loadMoreError) as Error | undefined;

  const items = useMemo(() => flattenDocumentCommentReplies(feed?.items), [feed?.items]);
  const loadMore = useCallback(
    () => (enabledId ? documentCommentActions.loadMoreReplies(enabledId) : Promise.resolve()),
    [enabledId],
  );
  const reload = useCallback(
    () => (enabledId ? documentCommentActions.revalidateReplies(enabledId) : Promise.resolve()),
    [enabledId],
  );

  return {
    error,
    isValidating: sync.isValidating,
    ...getFeedPaginationState(feed, {
      enabled: enabled && Boolean(enabledId),
      error,
      isValidating: sync.isValidating,
    }),
    items,
    loadMore,
    reload,
  };
};
