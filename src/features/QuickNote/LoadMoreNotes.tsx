'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuickNoteStore } from '@/store/quickNote';

/** Loads the next page of notes at the end of a Quick Note list surface, with an inline retry. */
const LoadMoreNotes = memo(() => {
  const { t } = useTranslation('note');
  const [hasMore, loading, failed, loadMoreNotes] = useQuickNoteStore((s) => [
    s.notesHasMore,
    s.notesLoadingMore,
    s.notesLoadMoreError,
    s.loadMoreNotes,
  ]);

  if (!hasMore) return null;

  return (
    <Flexbox align={'center'} gap={4} paddingBlock={8}>
      {failed && (
        <Text fontSize={12} type={'danger'}>
          {t('list.loadMoreFailed')}
        </Text>
      )}
      <Button loading={loading} size={'small'} type={'text'} onClick={loadMoreNotes}>
        {failed ? t('list.retryLoad') : t('list.loadMore')}
      </Button>
    </Flexbox>
  );
});

LoadMoreNotes.displayName = 'QuickNoteLoadMoreNotes';

export default LoadMoreNotes;
