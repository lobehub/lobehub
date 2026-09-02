'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Button, Skeleton, Text, toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { documentCommentService } from '@/services/documentComment';

import Composer from './Composer';
import {
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
import { styles } from './styles';
import Thread from './Thread';
import {
  type DocumentCommentFocusMissReason,
  useDocumentCommentDeepLink,
} from './useDocumentCommentDeepLink';

const DocumentComments = memo<{ documentId: string }>(({ documentId }) => {
  const { t } = useTranslation('file');
  const workspaceId = useActiveWorkspaceId();
  const summary = useDocumentCommentSummary(workspaceId ? documentId : undefined);
  const threads = useDocumentCommentThreads(workspaceId ? documentId : undefined);
  const createOptimistic = useOptimisticDocumentComment();
  const { clearFocus, focus, focusRoot } = useDocumentCommentDeepLink(documentId);
  const reloadSummary = summary.mutate;
  const reloadThreads = threads.reload;
  const mutateThreads = threads.mutate;
  const refresh = useCallback(async () => {
    await Promise.all([reloadThreads(), reloadSummary()]);
  }, [reloadSummary, reloadThreads]);
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
      mutateThreads((pages) => updateThreadReplyCount(pages, rootCommentId, delta), {
        revalidate: false,
      }),
    [mutateThreads],
  );
  const handleCreate = useCallback(
    async ({ clientId, content, editorData }: DocumentCommentSubmitInput) => {
      const optimisticComment = createOptimistic({ clientId, content, documentId, editorData });
      await Promise.all([
        mutateThreads((pages) => appendOptimisticThread(pages, optimisticComment), {
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
        });
        if (!created) throw new Error('Document comment creation returned no result');
      } catch (error) {
        await Promise.all([
          mutateThreads((pages) => removeOptimisticThread(pages, clientId), {
            revalidate: false,
          }),
          updateSummaryTotal(-1),
        ]);
        throw error;
      }

      try {
        await mutateThreads((pages) => replaceOptimisticThread(pages, created.comment), {
          revalidate: false,
        });
      } catch (error) {
        console.error('Failed to reconcile the created document comment', error);
        void reloadThreads();
      }
      if (created.isDuplicate) void reloadSummary();
    },
    [createOptimistic, documentId, mutateThreads, reloadSummary, reloadThreads, updateSummaryTotal],
  );
  const handleUpdate: DocumentCommentUpdateHandler = useCallback(
    async (comment, value) => {
      const optimisticComment = { ...comment, ...value, updatedAt: new Date() };
      await mutateThreads((pages) => replaceThreadComment(pages, optimisticComment), {
        revalidate: false,
      });

      let updated: Awaited<ReturnType<typeof documentCommentService.update>>;
      try {
        updated = await documentCommentService.update({ ...value, id: comment.id });
        if (!updated) throw new Error('Document comment update returned no result');
      } catch (error) {
        await mutateThreads((pages) => replaceThreadComment(pages, comment), {
          revalidate: false,
        });
        throw error;
      }

      try {
        await mutateThreads((pages) => replaceThreadComment(pages, updated), {
          revalidate: false,
        });
      } catch (error) {
        console.error('Failed to reconcile the updated document comment', error);
        void reloadThreads();
      }
    },
    [mutateThreads, reloadThreads],
  );
  const isHeaderLoading = threads.isLoadingInitial || (summary.isLoading && !summary.data);

  // Deep-link landing. Lists are oldest-first and a notification usually points at the
  // newest comment, so the target root is fetched by id and pinned above the list until it
  // shows up on a loaded page. NOT_FOUND, a non-root id, or a root from another document
  // means the thread is gone; any other lookup failure is reported, never swallowed.
  const focusRootCommentId = focus?.rootCommentId;
  const hasFocusedThread =
    Boolean(focusRootCommentId) && threads.items.some(({ root }) => root.id === focusRootCommentId);
  const focusedRoot = useDocumentCommentDetail(hasFocusedThread ? undefined : focusRootCommentId);
  const focusedRootData = focusedRoot.data;
  const isFocusedRootUsable =
    Boolean(focusedRootData) &&
    !focusedRootData?.parentCommentId &&
    focusedRootData?.documentId === documentId;
  const pinnedThread =
    focus && !hasFocusedThread && focusedRootData && isFocusedRootUsable
      ? { replyCount: focusedRootData.replyCount, root: focusedRootData }
      : undefined;
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

  if (!workspaceId) return null;

  return (
    <Flexbox
      data-document-comments
      className={styles.section}
      gap={24}
      onClick={(event) => event.stopPropagation()}
    >
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        {isHeaderLoading ? (
          <>
            <Skeleton height={28} width={48} />
            <Skeleton height={20} width={16} />
          </>
        ) : (
          <>
            <Text as={'h2'} fontSize={20} weight={600}>
              {t('pageEditor.comments.title')}
            </Text>
            {summary.data && (
              <Text className={styles.meta} fontSize={14}>
                {summary.data.total}
              </Text>
            )}
          </>
        )}
      </Flexbox>

      {/* The pinned deep-link thread renders on its own, so a pending or failed list
          request never hides a target that was already fetched. */}
      {threads.isInitialError ||
      threads.isLoadingInitial ||
      threads.items.length > 0 ||
      pinnedThread ? (
        <Flexbox className={styles.threadList}>
          {pinnedThread && (
            <Thread
              documentId={documentId}
              focus={focus}
              key={pinnedThread.root.id}
              replyCount={pinnedThread.replyCount}
              root={pinnedThread.root}
              onFocusMissing={handleReplyFocusMissing}
              onMutated={refreshPinned}
              onReplyCountChange={updatePinnedReplyCount}
              onRootUpdate={handlePinnedRootUpdate}
              onSummaryChange={updateSummaryTotal}
            />
          )}
          {threads.isInitialError ? (
            <AsyncError
              error={threads.error}
              variant={'block'}
              onRetry={() => void threads.reload()}
            />
          ) : threads.isLoadingInitial ? (
            <SurfaceSkeleton header={false} variant={'list'} />
          ) : (
            threads.items.map(({ replyCount, root }) => (
              <Thread
                documentId={documentId}
                focus={focus?.rootCommentId === root.id ? focus : undefined}
                key={root.id}
                replyCount={replyCount}
                root={root}
                onFocusMissing={handleReplyFocusMissing}
                onMutated={refresh}
                onReplyCountChange={updateReplyCount}
                onRootUpdate={handleUpdate}
                onSummaryChange={updateSummaryTotal}
              />
            ))
          )}
          {threads.error && !threads.isInitialError ? (
            <AsyncError
              error={threads.error}
              retrying={threads.isRetrying}
              variant={'inline'}
              onRetry={() => void threads.reload()}
            />
          ) : (
            threads.hasMore && (
              <Center paddingBlock={12}>
                <Button
                  loading={threads.isLoadingMore}
                  type={'text'}
                  onClick={() => void threads.loadMore()}
                >
                  {t('pageEditor.comments.loadMore')}
                </Button>
              </Center>
            )
          )}
        </Flexbox>
      ) : null}

      {/* While the thread list is still skeleton-loading the composer would
          float against placeholder content — reveal it with the real list. */}
      {!threads.isLoadingInitial && (
        <Composer documentId={documentId} key={`root:${documentId}`} onSubmit={handleCreate} />
      )}
    </Flexbox>
  );
});

DocumentComments.displayName = 'DocumentComments';

export default DocumentComments;
