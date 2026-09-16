'use client';

import type {
  DocumentCommentAnchorItem,
  DocumentCommentThread,
  DocumentCommentThreadPage,
} from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { type RefObject, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { documentCommentService } from '@/services/documentComment';

import { useDocumentCommentAnchors } from './anchor/useDocumentCommentAnchors';
import {
  useDocumentCommentAnchorList,
  useDocumentCommentDetail,
  useDocumentCommentSummary,
  useDocumentCommentThreads,
  useOptimisticDocumentComment,
} from './hooks';
import type { DocumentCommentSubmitInput, DocumentCommentUpdateHandler } from './optimistic';
import {
  appendOptimisticThread,
  removeOptimisticThread,
  replaceOptimisticThread,
  replaceThreadComment,
  updateThreadReplyCount,
} from './optimistic';
import {
  type DocumentCommentFocusMissReason,
  useDocumentCommentDeepLink,
} from './useDocumentCommentDeepLink';

type PageMutator = (
  pages: DocumentCommentThreadPage[] | undefined,
) => DocumentCommentThreadPage[] | undefined;

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
 * Everything the two comment surfaces share: the paged thread caches, the
 * optimistic write-through handlers, the deep-link landing and the anchor
 * resolution. Anchored roots and document-level roots are paged separately
 * (see `listThreads`' `anchored` filter) because they render in different
 * places; a write goes to whichever cache the comment belongs in, and a patch
 * that could apply to either is applied to both.
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
  const anchoredThreads = useDocumentCommentThreads(enabledDocumentId, 'anchored');
  const documentThreads = useDocumentCommentThreads(enabledDocumentId, 'document');
  const anchorList = useDocumentCommentAnchorList(enabledDocumentId);
  const createOptimistic = useOptimisticDocumentComment();
  const { clearFocus, focus, focusRoot, focusThread } = useDocumentCommentDeepLink(documentId);
  const reloadSummary = summary.mutate;
  const reloadAnchored = anchoredThreads.reload;
  const reloadDocument = documentThreads.reload;
  const mutateAnchored = anchoredThreads.mutate;
  const mutateDocument = documentThreads.mutate;
  const mutateAnchors = anchorList.mutate;

  const mutateBoth = useCallback(
    (mutator: PageMutator) =>
      Promise.all([
        mutateAnchored(mutator, { revalidate: false }),
        mutateDocument(mutator, { revalidate: false }),
      ]),
    [mutateAnchored, mutateDocument],
  );
  const reloadThreads = useCallback(
    () => Promise.all([reloadAnchored(), reloadDocument()]),
    [reloadAnchored, reloadDocument],
  );
  const refresh = useCallback(async () => {
    await Promise.all([reloadThreads(), reloadSummary(), mutateAnchors()]);
  }, [mutateAnchors, reloadSummary, reloadThreads]);
  const updateSummaryTotal = useCallback(
    (delta: number) =>
      reloadSummary(
        (current) =>
          current ? { ...current, total: Math.max(0, current.total + delta) } : current,
        { revalidate: false },
      ),
    [reloadSummary],
  );
  const updateReplyCount = useCallback(
    (rootCommentId: string, delta: number) =>
      mutateBoth((pages) => updateThreadReplyCount(pages, rootCommentId, delta)),
    [mutateBoth],
  );
  const handleCreate = useCallback(
    async ({ clientId, content, editorData, selectionAnchor }: DocumentCommentSubmitInput) => {
      // A root lives in exactly one of the two caches, decided by its anchor.
      const mutateOwn = selectionAnchor ? mutateAnchored : mutateDocument;
      const reloadOwn = selectionAnchor ? reloadAnchored : reloadDocument;
      const optimisticComment = createOptimistic({
        clientId,
        content,
        documentId,
        editorData,
        selectionAnchor,
      });
      await Promise.all([
        mutateOwn((pages) => appendOptimisticThread(pages, optimisticComment), {
          revalidate: false,
        }),
        updateSummaryTotal(1),
      ]);

      let created: Awaited<ReturnType<typeof documentCommentService.create>>;
      try {
        created = await documentCommentService.create({
          clientId,
          content,
          documentId,
          editorData,
          selectionAnchor,
        });
        if (!created) throw new Error('Document comment creation returned no result');
      } catch (error) {
        await Promise.all([
          mutateOwn((pages) => removeOptimisticThread(pages, clientId), { revalidate: false }),
          updateSummaryTotal(-1),
        ]);
        throw error;
      }

      try {
        await mutateOwn((pages) => replaceOptimisticThread(pages, created.comment), {
          revalidate: false,
        });
      } catch (error) {
        console.error('Failed to reconcile the created document comment', error);
        void reloadOwn();
      }
      if (created.isDuplicate) void reloadSummary();
      // The body paints from the document-wide anchor list, so the new root
      // joins it here rather than waiting for the next revalidation.
      const createdAnchor = created.comment.selectionAnchor;
      if (createdAnchor) {
        void mutateAnchors(
          (current) =>
            current && !current.items.some(({ id }) => id === created.comment.id)
              ? {
                  items: [
                    ...current.items,
                    { id: created.comment.id, selectionAnchor: createdAnchor },
                  ],
                }
              : current,
          { revalidate: false },
        );
      }
    },
    [
      createOptimistic,
      documentId,
      mutateAnchored,
      mutateAnchors,
      mutateDocument,
      reloadAnchored,
      reloadDocument,
      reloadSummary,
      updateSummaryTotal,
    ],
  );
  const handleUpdate: DocumentCommentUpdateHandler = useCallback(
    async (comment, value) => {
      const optimisticComment = { ...comment, ...value, updatedAt: new Date() };
      await mutateBoth((pages) => replaceThreadComment(pages, optimisticComment));

      let updated: Awaited<ReturnType<typeof documentCommentService.update>>;
      try {
        updated = await documentCommentService.update({ ...value, id: comment.id });
        if (!updated) throw new Error('Document comment update returned no result');
      } catch (error) {
        await mutateBoth((pages) => replaceThreadComment(pages, comment));
        throw error;
      }

      try {
        await mutateBoth((pages) => replaceThreadComment(pages, updated));
      } catch (error) {
        console.error('Failed to reconcile the updated document comment', error);
        void reloadThreads();
      }
    },
    [mutateBoth, reloadThreads],
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
    for (const { id, selectionAnchor } of anchorList.data?.items ?? []) {
      byId.set(id, { id, selectionAnchor });
    }
    const loaded = pinnedThread ? [pinnedThread, ...anchoredThreads.items] : anchoredThreads.items;
    for (const { root } of loaded) {
      if (root.selectionAnchor && !byId.has(root.id)) {
        byId.set(root.id, { id: root.id, selectionAnchor: root.selectionAnchor });
      }
    }
    return [...byId.values()];
  }, [anchorList.data, pinnedThread, anchoredThreads.items]);
  const anchors = useDocumentCommentAnchors(anchorItems, { onPickUnloaded: focusThread });
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
  // The pinned root lives in its own detail entry, so the list handlers (which only patch
  // the paginated caches) are mirrored into it; a post-delete 404 flows through
  // `isNotFound` and is not a refresh failure.
  const mutateFocusedRoot = focusedRoot.mutate;
  const refreshPinned = useCallback(async () => {
    await Promise.all([mutateFocusedRoot().catch(() => undefined), refresh()]);
  }, [mutateFocusedRoot, refresh]);
  const updatePinnedReplyCount = useCallback(
    async (rootCommentId: string, delta: number) => {
      await Promise.all([
        updateReplyCount(rootCommentId, delta),
        mutateFocusedRoot(
          (current) =>
            current && current.id === rootCommentId
              ? { ...current, replyCount: Math.max(0, current.replyCount + delta) }
              : current,
          { revalidate: false },
        ),
      ]);
    },
    [mutateFocusedRoot, updateReplyCount],
  );
  const handlePinnedRootUpdate: DocumentCommentUpdateHandler = useCallback(
    async (comment, value) => {
      await handleUpdate(comment, value);
      await mutateFocusedRoot(
        (current) =>
          current && current.id === comment.id
            ? { ...current, ...value, updatedAt: new Date() }
            : current,
        { revalidate: false },
      );
    },
    [handleUpdate, mutateFocusedRoot],
  );

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

  return {
    anchors,
    documentId,
    documentThreads,
    focus,
    gutterEnabled,
    gutterThreads,
    handleCreate,
    handlePinnedRootUpdate,
    handleReplyFocusMissing,
    handleUpdate,
    isAnchoredLoading: anchoredThreads.isLoadingInitial,
    listThreads,
    paneRef,
    panelAvailable,
    pinnedThread,
    pinnedThreadInGutter: pinnedInGutter ? pinnedThread : undefined,
    pinnedThreadInList: pinnedThread,
    refresh,
    refreshPinned,
    summary,
    updatePinnedReplyCount,
    updateReplyCount,
    updateSummaryTotal,
    workspaceId,
  };
};

export type DocumentCommentsState = ReturnType<typeof useDocumentCommentsState>;
