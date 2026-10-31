'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import { useConversationStore } from '../../store';
import { type HistoryPageSide } from './HistoryPageSkeleton';

/**
 * Inline failure row shown where a page of history failed to load: above the
 * messages for earlier history, below them for later rounds. Scroll gestures
 * stop re-firing the request while it stands, so Retry is the explicit way
 * back. A retry clears the error as it starts, handing the row over to the
 * skeleton.
 *
 * Like `HistoryPageSkeleton`, it subscribes to the store itself: virtua caches
 * the slot row's element, so a prop passed from the list would never repaint it.
 */
const HistoryPageError = memo<{ side: HistoryPageSide }>(({ side }) => {
  const { t } = useTranslation('chat');
  const error = useConversationStore((s) =>
    side === 'earlier' ? s.earlierMessagesError : s.laterMessagesError,
  );
  const loadPage = useConversationStore((s) =>
    side === 'earlier' ? s.loadEarlierMessages : s.loadLaterMessages,
  );

  const handleRetry = useCallback(() => {
    void loadPage({ retry: true });
  }, [loadPage]);

  if (error === undefined) return null;

  return (
    <Flexbox horizontal align={'center'} aria-live={'polite'} justify={'center'} role={'status'}>
      <AsyncError
        error={error}
        variant={'inline'}
        title={t(
          side === 'earlier' ? 'chatList.earlierHistoryError' : 'chatList.laterHistoryError',
        )}
        onRetry={handleRetry}
      />
    </Flexbox>
  );
});

HistoryPageError.displayName = 'HistoryPageError';

export default HistoryPageError;
