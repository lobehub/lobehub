import type {
  DocumentCommentDetail,
  DocumentCommentItem,
  DocumentCommentReplyPage,
  DocumentCommentSummary,
  DocumentCommentThreadPage,
} from '@lobechat/types';
import { useCallback } from 'react';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { documentCommentKeys } from '@/libs/swr/keys';
import { documentCommentService } from '@/services/documentComment';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  createOptimisticComment,
  flattenDocumentCommentReplies,
  flattenDocumentCommentThreads,
} from './optimistic';

const PAGE_SIZE = 20;

const fetchThreads = ([, , documentId, cursor]: readonly string[]) =>
  documentCommentService.listThreads({
    cursor: cursor || undefined,
    documentId,
    limit: PAGE_SIZE,
  });

const fetchReplies = ([, , rootCommentId, cursor]: readonly string[]) =>
  documentCommentService.listReplies({
    cursor: cursor || undefined,
    limit: PAGE_SIZE,
    rootCommentId,
  });

const getPaginationState = <T extends { nextCursor: string | null }>(
  data: T[] | undefined,
  error: unknown,
  isLoading: boolean,
  isValidating: boolean,
  size: number,
) => {
  const hasLoadedPages = data !== undefined;
  const lastPage = data?.findLast(Boolean);

  return {
    hasMore: !error && Boolean(lastPage?.nextCursor),
    isInitialError: Boolean(error) && !hasLoadedPages,
    isLoadingInitial: !error && isLoading && !hasLoadedPages,
    isLoadingMore: !error && hasLoadedPages && size > 0 && typeof data?.[size - 1] === 'undefined',
    isRetrying: Boolean(error) && isValidating,
  };
};

export const useDocumentCommentSummary = (documentId?: string | null) =>
  useClientDataSWR<DocumentCommentSummary>(
    documentId ? documentCommentKeys.summary(documentId) : null,
    () => documentCommentService.summary(documentId!),
    { dedupingInterval: 30_000 },
  );

/**
 * One comment by id. Lists are oldest-first and a notification usually points
 * at the newest comment, so a deep link fetches its target directly instead of
 * paging towards it; `isNotFound` means the comment is gone.
 */
export const useDocumentCommentDetail = (commentId?: string | null) => {
  const workspaceId = useActiveWorkspaceId();
  const response = useClientDataSWR<DocumentCommentDetail>(
    commentId && workspaceId ? documentCommentKeys.detail(workspaceId, commentId) : null,
    () => documentCommentService.get(commentId!),
  );

  return { ...response, isNotFound: isTrpcErrorCode(response.error, 'NOT_FOUND') };
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
    }: {
      clientId: string;
      content: string;
      documentId: string;
      editorData: DocumentCommentItem['editorData'];
      parentCommentId?: string;
      replyTo?: DocumentCommentItem['replyTo'];
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
        userId: user?.id ?? null,
        workspaceId,
      });
    },
    [user?.avatar, user?.fullName, user?.id, user?.username, workspaceId],
  );
};

export const useDocumentCommentThreads = (documentId?: string | null) => {
  const workspaceId = useActiveWorkspaceId();
  const getKey = useCallback(
    (_index: number, previous: DocumentCommentThreadPage | null) => {
      if (!documentId || !workspaceId || previous?.nextCursor === null) return null;
      return documentCommentKeys.threads(
        workspaceId,
        documentId,
        previous?.nextCursor ?? undefined,
      );
    },
    [documentId, workspaceId],
  );
  const response = useSWRInfinite<DocumentCommentThreadPage>(getKey, fetchThreads, {
    revalidateFirstPage: false,
  });

  return {
    ...response,
    ...getPaginationState(
      response.data,
      response.error,
      response.isLoading,
      response.isValidating,
      response.size,
    ),
    items: flattenDocumentCommentThreads(response.data),
    loadMore: () => response.setSize((current) => current + 1),
    reload: () => response.mutate(),
  };
};

export const useDocumentCommentReplies = (
  rootCommentId: string | null | undefined,
  enabled: boolean,
) => {
  const workspaceId = useActiveWorkspaceId();
  const getKey = useCallback(
    (_index: number, previous: DocumentCommentReplyPage | null) => {
      if (!enabled || !rootCommentId || !workspaceId || previous?.nextCursor === null) return null;
      return documentCommentKeys.replies(
        workspaceId,
        rootCommentId,
        previous?.nextCursor ?? undefined,
      );
    },
    [enabled, rootCommentId, workspaceId],
  );
  const response = useSWRInfinite<DocumentCommentReplyPage>(getKey, fetchReplies, {
    revalidateFirstPage: false,
  });

  return {
    ...response,
    ...getPaginationState(
      response.data,
      response.error,
      response.isLoading,
      response.isValidating,
      response.size,
    ),
    items: flattenDocumentCommentReplies(response.data),
    loadMore: () => response.setSize((current) => current + 1),
    reload: () => response.mutate(),
  };
};
