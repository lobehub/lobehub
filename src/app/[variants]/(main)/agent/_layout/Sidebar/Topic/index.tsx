'use client';

import { AccordionItem, Dropdown, Flexbox, Text } from '@lobehub/ui';
import React, { Suspense, memo } from 'react';
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
      headerWrapper={(header) => (
        <Dropdown
          menu={{
            items: dropdownMenu,
          }}
          trigger={['contextMenu']}
        >
          {header}
        </Dropdown>
      )}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox align="center" gap={4} horizontal>
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
