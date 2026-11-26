'use client';

import { Button, Center } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import { useConversationStore } from '../../store';

interface CompressedHistoryGapProps {
  /** The row right below the gap, kept in place on screen while members load above it. */
  anchorId?: string;
  groupId: string;
  onLoad: (groupId: string, anchorId: string | undefined, retry: boolean) => Promise<void>;
}

/**
 * Stands where a later compression group's unloaded members belong, between
 * the group above and this group's loaded members. Reaching the top only pages
 * the oldest group, so these load on request: loading them as the row scrolls
 * into view would insert rows above the reader and shift what they are reading.
 *
 * A failed page stays on this gap with its own Retry, since the top-of-list
 * error row retries the oldest group, not this one.
 */
const CompressedHistoryGap = memo<CompressedHistoryGapProps>(({ anchorId, groupId, onLoad }) => {
  const { t } = useTranslation('chat');
  const loading = useConversationStore((s) => s.isLoadingEarlierMessages);
  const error = useConversationStore((s) =>
    s.compressedHistoryError?.groupId === groupId ? s.compressedHistoryError.error : undefined,
  );
  const hasError = error !== undefined;

  const handleClick = useCallback(() => {
    void onLoad(groupId, anchorId, hasError);
  }, [anchorId, groupId, hasError, onLoad]);

  if (hasError)
    return (
      <Center aria-live={'polite'} paddingBlock={8} role={'status'}>
        <AsyncError
          error={error}
          title={t('chatList.earlierHistoryError')}
          variant={'inline'}
          onRetry={handleClick}
        />
      </Center>
    );

  return (
    <Center paddingBlock={8}>
      <Button loading={loading} size={'small'} type={'text'} onClick={handleClick}>
        {t('compression.loadEarlier')}
      </Button>
    </Center>
  );
});

CompressedHistoryGap.displayName = 'CompressedHistoryGap';

export default CompressedHistoryGap;
