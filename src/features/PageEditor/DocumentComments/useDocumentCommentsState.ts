'use client';

import type { DocumentCommentAnchorItem, DocumentCommentThread } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { type RefObject, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { documentCommentActions } from '@/store/documentComment';

import { useDocumentCommentAnchors } from './anchor/useDocumentCommentAnchors';
import {
  ANCHORED_EAGER_PAGE_LIMIT,
  useDocumentCommentAnchorList,
  useDocumentCommentDetail,
  useDocumentCommentSummary,
  useDocumentCommentThreads,
  useOptimisticDocumentComment,
} from './hooks';
import type { DocumentCommentSubmitInput } from './optimistic';
import {
  type DocumentCommentFocusMissReason,
  useDocumentCommentDeepLink,
} from './useDocumentCommentDeepLink';

export interface DocumentCommentsStateOptions {
  documentId: string;
  /**
   * Whether anchored threads render in the comments panel beside the text.
   * While the panel is closed or showing something else, they fall back to
   * the list below the body.
   */
  gutterEnabled: boolean;
  /** Whether a comments panel can exist at all (the editor renders its own right panel). */
  panelAvailable: boolean;
  /** The body's scroll container; the panel's cards follow its scroll. */
  paneRef: RefObject<HTMLElement | null>;
}

/**
 * Everything the two comment surfaces share: the root feeds, the write
 * handlers, the deep-link landing and the anchor resolution. Anchored roots
 * and document-level roots are separate replica feeds (see `listThreads`'
 * `anchored` filter) because they render in different places; the store
 * routes each write to the feed the comment belongs in.
 */
export const useDocumentCommentsState = ({
  documentId,
  gutterEnabled,
  paneRef,
  panelAvailable,
}: DocumentCommentsStateOptions) => {
  const { t } = useTranslation('file');
  const workspaceId = useActiveWorkspaceId();
  const enabledDocumentId = workspaceId ? documentId : undefined;
  const summary = useDocumentCommentSummary(enabledDocumentId);
  // Anchored threads are fetched ahead of demand only while the gutter shows
  // them, and only up to a budget; a closed panel paints its highlights from
  // the anchor list alone and fetches a picked thread on demand.
  const anchoredThreads = useDocumentCommentThreads(enabledDocumentId, 'anchored', {
    eagerPageLimit: gutterEnabled ? ANCHORED_EAGER_PAGE_LIMIT : 0,
  });
  const documentThreads = useDocumentCommentThreads(enabledDocumentId, 'document');
  const anchorList = useDocumentCommentAnchorList(enabledDocumentId);
  const createOptimistic = useOptimisticDocumentComment();
  const { clearFocus, focus, focusRoot, focusThread } = useDocumentCommentDeepLink(documentId);
  const reloadAnchored = anchoredThreads.reload;

  const refresh = useCallback(
    () => documentCommentActions.revalidateDocument(documentId),
    [documentId],
  );
  const handleCreate = useCallback(
    async ({ clientId, content, editorData, selectionAnchor }: DocumentCommentSubmitInput) => {
      const input = { clientId, content, documentId, editorData, selectionAnchor };
      await documentCommentActions.createRootComment({
        input,
        optimisticComment: createOptimistic(input),
      });
    },
    [createOptimistic, documentId],
  );
  // Deep-link landing. Lists are oldest-first and a notification usually points at the
  // newest comment, so the target root is fetched by id and pinned above the list until it
  // shows up on a loaded page. NOT_FOUND, a non-root id, or a root from another document
  // means the thread is gone; any other lookup failure is reported, never swallowed.
  const focusRootCommentId = focus?.rootCommentId;
  const hasFocusedThread =
    Boolean(focusRootCommentId) &&
    (anchoredThreads.items.some(({ root }) => root.id === focusRootCommentId) ||
      documentThreads.items.some(({ root }) => root.id === focusRootCommentId));
  const focusedRoot = useDocumentCommentDetail(hasFocusedThread ? undefined : focusRootCommentId);
  const focusedRootData = focusedRoot.data;
  const isFocusedRootUsable =
    Boolean(focusedRootData) &&
    !focusedRootData?.parentCommentId &&
    focusedRootData?.documentId === documentId;
  const pinnedThread = useMemo<DocumentCommentThread | undefined>(
    () =>
      focus && !hasFocusedThread && focusedRootData && isFocusedRootUsable
        ? { replyCount: focusedRootData.replyCount, root: focusedRootData }
        : undefined,
    [focus, focusedRootData, hasFocusedThread, isFocusedRootUsable],
  );
  // Highlights come from the document-wide anchor list so every anchored run
  // is discoverable from the body, however far down the list its card sits.
  // Loaded pages and the pinned thread are folded in on top: an optimistic
  // root has no server row yet, and a pinned root may predate the last fetch.
  const anchorItems = useMemo(() => {
    const byId = new Map<string, DocumentCommentAnchorItem>();
    for (const { id, selectionAnchor } of anchorList?.items ?? []) {
      byId.set(id, { id, selectionAnchor });
    }
    const loaded = pinnedThread ? [pinnedThread, ...anchoredThreads.items] : anchoredThreads.items;
    for (const { root } of loaded) {
      if (root.selectionAnchor && !byId.has(root.id)) {
        byId.set(root.id, { id: root.id, selectionAnchor: root.selectionAnchor });
      }
    }
    return [...byId.values()];
  }, [anchorList, pinnedThread, anchoredThreads.items]);
  const anchors = useDocumentCommentAnchors(anchorItems, {
    hasGutter: panelAvailable,
    onPickUnloaded: focusThread,
  });
  const { orphanedRootIds } = anchors;

  const isFocusedRootMissing =
    Boolean(focusRootCommentId) &&
    (focusedRoot.isNotFound || (Boolean(focusedRootData) && !isFocusedRootUsable));
  const isFocusedRootFailed =
    Boolean(focusRootCommentId) && Boolean(focusedRoot.error) && !focusedRoot.isNotFound;
  const handleFocusMissing = useCallback(() => {
    toast.info(t('pageEditor.comments.deepLinkMissing'));
    clearFocus();
  }, [clearFocus, t]);
  const handleFocusFailed = useCallback(() => {
    toast.error(t('pageEditor.comments.deepLinkLoadFailed'));
    clearFocus();
  }, [clearFocus, t]);
  // The linked reply is gone (or failed to load) but its thread is not: keep the thread and
  // land on the root.
  const handleReplyFocusMissing = useCallback(
    (reason: DocumentCommentFocusMissReason) => {
      if (reason === 'missing') toast.info(t('pageEditor.comments.deepLinkMissing'));
      else toast.error(t('pageEditor.comments.deepLinkLoadFailed'));
      focusRoot();
    },
    [focusRoot, t],
  );
  useEffect(() => {
    if (isFocusedRootMissing) handleFocusMissing();
    else if (isFocusedRootFailed) handleFocusFailed();
  }, [handleFocusFailed, handleFocusMissing, isFocusedRootFailed, isFocusedRootMissing]);
  // The pinned root lives in its own detail entry, which the store patches on
  // every write; a refresh re-reads it too, and a post-delete 404 flows
  // through `isNotFound` — it is not a refresh failure.
  const refreshPinned = useCallback(async () => {
    await Promise.all([
      focusRootCommentId ? documentCommentActions.revalidateDetail(focusRootCommentId) : undefined,
      refresh(),
    ]);
  }, [focusRootCommentId, refresh]);

  /** A thread belongs in the gutter when it has a run to sit beside. */
  const isGutterThread = useCallback(
    ({ root }: DocumentCommentThread) =>
      gutterEnabled && Boolean(root.selectionAnchor) && !orphanedRootIds.has(root.id),
    [gutterEnabled, orphanedRootIds],
  );
  const gutterThreads = useMemo(
    () => anchoredThreads.items.filter((thread) => isGutterThread(thread)),
    [anchoredThreads.items, isGutterThread],
  );
  // The list below the body is the document's complete record — anchored
  // roots included, each with its quote — while the panel beside the text
  // is the in-context view of the anchored subset. Its header counts every
  // comment, so it lists every comment.
  const listThreads = useMemo(() => {
    if (anchoredThreads.items.length === 0) return documentThreads.items;
    return [...documentThreads.items, ...anchoredThreads.items].sort(
      (left, right) =>
        new Date(left.root.createdAt).getTime() - new Date(right.root.createdAt).getTime(),
    );
  }, [anchoredThreads.items, documentThreads.items]);
  const pinnedInGutter = Boolean(pinnedThread) && isGutterThread(pinnedThread!);
  // The list below the body pages both caches together: anchored roots past
  // the gutter's eager budget (or all of them while the panel is closed)
  // are only reachable through it.
  const hasMoreListThreads = documentThreads.hasMore || anchoredThreads.hasMore;
  const isLoadingMoreListThreads = documentThreads.isLoadingMore || anchoredThreads.isLoadingMore;
  const loadMoreAnchored = anchoredThreads.loadMore;
  const loadMoreDocument = documentThreads.loadMore;
  const loadMoreListThreads = useCallback(
    () =>
      Promise.all([
        documentThreads.hasMore ? loadMoreDocument() : undefined,
        anchoredThreads.hasMore ? loadMoreAnchored() : undefined,
      ]),
    [anchoredThreads.hasMore, documentThreads.hasMore, loadMoreAnchored, loadMoreDocument],
  );

  return {
    anchoredError: anchoredThreads.error,
    anchors,
    documentId,
    documentThreads,
    focus,
    gutterEnabled,
    gutterThreads,
    handleCreate,
    handleReplyFocusMissing,
    hasMoreListThreads,
    isAnchoredInitialError: anchoredThreads.isInitialError,
    isAnchoredLoading: anchoredThreads.isLoadingInitial,
    isAnchoredRetrying: anchoredThreads.isRetrying,
    isLoadingMoreListThreads,
    listThreads,
    loadMoreListThreads,
    paneRef,
    panelAvailable,
    pinnedThread,
    pinnedThreadInGutter: pinnedInGutter ? pinnedThread : undefined,
    pinnedThreadInList: pinnedThread,
    refresh,
    refreshPinned,
    reloadAnchored,
    summary,
    workspaceId,
  };
};

export type DocumentCommentsState = ReturnType<typeof useDocumentCommentsState>;
