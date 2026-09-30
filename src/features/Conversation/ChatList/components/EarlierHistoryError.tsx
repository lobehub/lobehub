'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import { useConversationStore } from '../../store';

/**
 * Inline failure row shown above the messages when a page of pre-window
 * history failed to load. Scroll gestures stop re-firing the request while it
 * stands, so Retry is the explicit way back. A retry clears the error as it
 * starts, handing the row over to the skeleton.
 *
 * Like `EarlierHistorySkeleton`, it subscribes to the store itself: virtua
 * caches the leading row's element, so a prop passed from the list would never
 * repaint it.
 */
const EarlierHistoryError = memo(() => {
  const { t } = useTranslation('chat');
  const error = useConversationStore((s) => s.earlierMessagesError);
  const loadEarlierMessages = useConversationStore((s) => s.loadEarlierMessages);

  const handleRetry = useCallback(() => {
    void loadEarlierMessages({ retry: true });
  }, [loadEarlierMessages]);

  if (error === undefined) return null;

  return (
    <Flexbox horizontal align={'center'} aria-live={'polite'} justify={'center'} role={'status'}>
      <AsyncError
        error={error}
        title={t('chatList.earlierHistoryError')}
        variant={'inline'}
        onRetry={handleRetry}
      />
    </Flexbox>
  );
});

EarlierHistoryError.displayName = 'EarlierHistoryError';

export default EarlierHistoryError;
