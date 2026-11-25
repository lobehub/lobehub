'use client';

import { Button, Center } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../store';

/**
 * Stands where a later compression group's unloaded members belong, between
 * the group above and this group's loaded members. Reaching the top only pages
 * the oldest group, so these load on request: loading them as the row scrolls
 * into view would insert rows above the reader and shift what they are reading.
 */
const CompressedHistoryGap = memo<{ groupId: string }>(({ groupId }) => {
  const { t } = useTranslation('chat');
  const loading = useConversationStore((s) => s.isLoadingEarlierMessages);
  const hasError = useConversationStore((s) => s.earlierMessagesError !== undefined);
  const load = useConversationStore((s) => s.loadCompressedGroupHistory);

  const handleClick = useCallback(() => {
    void load(groupId, { retry: hasError });
  }, [groupId, hasError, load]);

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
