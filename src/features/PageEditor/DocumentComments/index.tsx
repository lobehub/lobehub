'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';

import Composer from './Composer';
import { useDocumentComments } from './context';
import { styles } from './styles';
import Thread from './Thread';
import type { DocumentCommentsState } from './useDocumentCommentsState';

const DocumentCommentList = memo<{ state: DocumentCommentsState }>(({ state }) => {
  const { t } = useTranslation('file');
  const {
    documentId,
    documentThreads,
    focus,
    handleCreate,
    handlePinnedRootUpdate,
    handleReplyFocusMissing,
    handleUpdate,
    isAnchoredLoading,
    listThreads,
    panelAvailable,
    pinnedThreadInList,
    refresh,
    refreshPinned,
    summary,
    updatePinnedReplyCount,
    updateReplyCount,
    updateSummaryTotal,
  } = state;
  const isLoadingInitial = documentThreads.isLoadingInitial || isAnchoredLoading;
  const isHeaderLoading = isLoadingInitial || (summary.isLoading && !summary.data);

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
      isLoadingInitial ||
      listThreads.length > 0 ||
      pinnedThreadInList ? (
        <Flexbox className={styles.threadList}>
          {pinnedThreadInList && (
            <Thread
              documentId={documentId}
              focus={focus}
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
          {documentThreads.isInitialError ? (
            <AsyncError
              error={documentThreads.error}
              variant={'block'}
              onRetry={() => void documentThreads.reload()}
            />
          ) : isLoadingInitial ? (
            <SurfaceSkeleton header={false} variant={'list'} />
          ) : (
            listThreads.map(({ replyCount, root }) => (
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
