'use client';

import { Flexbox } from '@lobehub/ui';
import { Spin, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { delayed } from '@/components/Skeleton/Delayed';

import { dataSelectors, useConversationStore } from '../../store';

/**
 * "Fetching latest messages" hint beside the latest assistant reply's name,
 * shown while the conversation paints cached rows and its first server fetch
 * is still in flight. Held back like a route fallback so a fast fetch never
 * flashes it.
 */
const RefreshingIndicator = memo<{ messageId: string }>(({ messageId }) => {
  const { t } = useTranslation('chat');
  const isRefreshing = useConversationStore(dataSelectors.isRefreshingAt(messageId));

  if (!isRefreshing) return null;

  return delayed(
    <Flexbox horizontal align={'center'} aria-live={'polite'} gap={4} role={'status'}>
      <Spin size={'small'} variant={'network'} />
      <Text fontSize={12} type={'secondary'}>
        {t('chatList.refreshing')}
      </Text>
    </Flexbox>,
  );
});

RefreshingIndicator.displayName = 'ConversationRefreshingIndicator';

export default RefreshingIndicator;
