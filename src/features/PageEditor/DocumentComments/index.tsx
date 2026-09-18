'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';

import Composer from './Composer';
import { useDocumentComments } from './context';
import { styles } from './styles';
import Thread from './Thread';
import type { DocumentCommentFocus } from './useDocumentCommentDeepLink';
import type { DocumentCommentsState } from './useDocumentCommentsState';

/**
 * An anchored thread mounted in the gutter has two copies on screen at once;
 * only the gutter one sits beside its run, so a deep link scrolls through it
 * alone — the flat copy below the body just highlights, or its own scroll
 * would race the gutter's and could win, throwing the reader past a target
 * that was already in view beside the text.
 */
export const resolveListThreadFocus = (
  focus: DocumentCommentFocus | undefined,
  gutterShownIds: ReadonlySet<string>,
  rootId: string,
): DocumentCommentFocus | undefined => {
  if (focus?.rootCommentId !== rootId) return undefined;
  return gutterShownIds.has(rootId) ? { ...focus, scroll: false } : focus;
};

const DocumentCommentList = memo<{ state: DocumentCommentsState }>(({ state }) => {
  const { t } = useTranslation('file');
  const {
    anchoredError,
    documentId,
    documentThreads,
    focus,
    gutterThreads,
    handleCreate,
    handlePinnedRootUpdate,
    handleReplyFocusMissing,
    handleUpdate,
    isAnchoredInitialError,
    isAnchoredLoading,
    isAnchoredRetrying,
    listThreads,
    panelAvailable,
    pinnedThreadInGutter,
    pinnedThreadInList,
    refresh,
    refreshPinned,
    reloadAnchored,
    summary,
    updatePinnedReplyCount,
    updateReplyCount,
    updateSummaryTotal,
  } = state;
  const isLoadingInitial = documentThreads.isLoadingInitial || isAnchoredLoading;
  const isHeaderLoading = isLoadingInitial || (summary.isLoading && !summary.data);
  // The document and anchored queries are independent; one failing or still
  // loading must not hide comments the other already fetched successfully.
  const hasAnyItems = listThreads.length > 0 || Boolean(pinnedThreadInList);
  // An anchored thread also mounted in the gutter has two copies on screen at
  // once; only that copy sits beside its run, so a deep link scrolls through
  // it alone — this one just highlights, or the flat copy's own scroll would
  // race it down to the list below the body.
  const gutterShownIds = useMemo(() => {
    const ids = new Set(gutterThreads.map(({ root }) => root.id));
    if (pinnedThreadInGutter) ids.add(pinnedThreadInGutter.root.id);
    return ids;
  }, [gutterThreads, pinnedThreadInGutter]);

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
      {documentThreads.isInitialError ||
      isAnchoredInitialError ||
      isLoadingInitial ||
      listThreads.length > 0 ||
      pinnedThreadInList ? (
        <Flexbox className={styles.threadList}>
          {pinnedThreadInList && (
            <Thread
              documentId={documentId}
              focus={resolveListThreadFocus(focus, gutterShownIds, pinnedThreadInList.root.id)}
              key={pinnedThreadInList.root.id}
              replyCount={pinnedThreadInList.replyCount}
              root={pinnedThreadInList.root}
              onFocusMissing={handleReplyFocusMissing}
              onMutated={refreshPinned}
              onReplyCountChange={updatePinnedReplyCount}
              onRootUpdate={handlePinnedRootUpdate}
              onSummaryChange={updateSummaryTotal}
            />
          )}
          {hasAnyItems ? (
            listThreads.map(({ replyCount, root }) => (
              <Thread
                documentId={documentId}
                focus={resolveListThreadFocus(focus, gutterShownIds, root.id)}
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
          ) : documentThreads.isInitialError ? (
            <AsyncError
              error={documentThreads.error}
              variant={'block'}
              onRetry={() => void documentThreads.reload()}
            />
          ) : isAnchoredInitialError ? (
            <AsyncError
              error={anchoredError}
              variant={'block'}
              onRetry={() => void reloadAnchored()}
            />
          ) : (
            isLoadingInitial && <SurfaceSkeleton header={false} variant={'list'} />
          )}
          {/* Shown alongside whichever branch rendered above: a query that
              failed its initial load must not hide comments the other query
              already fetched successfully. */}
          {hasAnyItems && documentThreads.isInitialError && (
            <AsyncError
              error={documentThreads.error}
              variant={'inline'}
              onRetry={() => void documentThreads.reload()}
            />
          )}
          {hasAnyItems && isAnchoredInitialError && (
            <AsyncError
              error={anchoredError}
              retrying={isAnchoredRetrying}
              variant={'inline'}
              onRetry={() => void reloadAnchored()}
            />
          )}
          {documentThreads.error && !documentThreads.isInitialError ? (
            <AsyncError
              error={documentThreads.error}
              retrying={documentThreads.isRetrying}
              variant={'inline'}
              onRetry={() => void documentThreads.reload()}
            />
          ) : (
            documentThreads.hasMore && (
              <Center paddingBlock={12}>
                <Button
                  loading={documentThreads.isLoadingMore}
                  type={'text'}
                  onClick={() => void documentThreads.loadMore()}
                >
                  {t('pageEditor.comments.loadMore')}
                </Button>
              </Center>
            )
          )}
          {/* Independent of the document query's own error/load-more slot above:
              an anchored-only failure must not hide document pagination. */}
          {anchoredError && !isAnchoredInitialError && (
            <AsyncError
              error={anchoredError}
              retrying={isAnchoredRetrying}
              variant={'inline'}
              onRetry={() => void reloadAnchored()}
            />
          )}
        </Flexbox>
      ) : null}

      {/* While the thread list is still skeleton-loading the composer would
          float against placeholder content — reveal it with the real list. */}
      {!isLoadingInitial && (
        <Composer
          // With a comments panel around, a selection opens the panel and is
          // written there; only an editor without one writes it down here.
          anchorMode={panelAvailable ? 'none' : 'inline'}
          documentId={documentId}
          key={`root:${documentId}`}
          onSubmit={handleCreate}
        />
      )}
    </Flexbox>
  );
});

DocumentCommentList.displayName = 'DocumentCommentList';

/**
 * The comment list below the body: every thread of the document, anchored
 * ones with their quote. Anchored threads with a live run additionally
 * render beside the text in `DocumentCommentsPanel` while it is open.
 */
const DocumentComments = memo(() => {
  const state = useDocumentComments();
  if (!state) return null;
  return <DocumentCommentList state={state} />;
});

DocumentComments.displayName = 'DocumentComments';

export default DocumentComments;
