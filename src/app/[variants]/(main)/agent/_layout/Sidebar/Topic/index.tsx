'use client';

import { AccordionItem, ContextMenuTrigger, Flexbox, Text } from '@lobehub/ui';
import React, { memo,Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import Actions from './Actions';
import List from './List';
import { useTopicActionsDropdownMenu } from './useDropdownMenu';

interface TopicProps {
  itemKey: string;
}

const Topic = memo<TopicProps>(({ itemKey }) => {
  const { t } = useTranslation(['topic', 'common']);
  const [topicCount] = useChatStore((s) => [topicSelectors.currentTopicCount(s)]);
  const dropdownMenu = useTopicActionsDropdownMenu();
  const { isRevalidating } = useFetchTopics({ excludeTriggers: ['cron'] });

  return (
    <AccordionItem
      action={<Actions />}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      headerWrapper={(header) => (
        <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
      )}
      title={
        <Flexbox horizontal align="center" gap={4}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {`${t('title')} ${topicCount > 0 ? topicCount : ''}`}
          </Text>
          {isRevalidating && <NeuralNetworkLoading size={14} />}
        </Flexbox>
      }
    >
      <Suspense fallback={<SkeletonList />}>
        <Flexbox gap={1} paddingBlock={1}>
          <List />
        </Flexbox>
      </Suspense>
    </AccordionItem>
  );
});

export default Topic;
