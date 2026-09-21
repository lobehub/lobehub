'use client';

import { ContextMenuTrigger, Flexbox } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  Spin,
  Text,
} from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import React, { memo, Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import Actions from './Actions';
import Filter from './Filter';
import List from './List';
import ToggleGroups from './ToggleGroups';
import { useTopicActionsDropdownMenu } from './useDropdownMenu';

interface TopicProps {
  expanded: boolean;
  itemKey: string;
}

const Topic = memo<TopicProps>(({ expanded, itemKey }) => {
  const { t } = useTranslation(['topic', 'common']);
  const topicCount = useChatStore((s) => topicSelectors.currentTopicCount(s));
  const cleanupStaleRunningTopics = useChatStore((s) => s.cleanupStaleRunningTopics);
  const dropdownMenu = useTopicActionsDropdownMenu();
  const { isRevalidating } = useFetchChatTopics();
  const hasRunWatchdogRef = useRef(false);

  useEffect(() => {
    if (!expanded || hasRunWatchdogRef.current) return;

    hasRunWatchdogRef.current = true;
    void cleanupStaleRunningTopics();
  }, [cleanupStaleRunningTopics, expanded]);

  return (
    <AccordionItem value={itemKey}>
      <ContextMenuTrigger items={dropdownMenu}>
        <AccordionHeader>
          <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
            <Flexbox horizontal align="center" gap={4}>
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {t('sidebar.title')}
              </Text>
              {topicCount > 0 && (
                <Text fontSize={11} type="secondary">
                  {topicCount}
                </Text>
              )}
              {isRevalidating && <Spin size="small" />}
            </Flexbox>
          </AccordionTrigger>
          <div
            className={cx(
              'accordion-action',
              accordionStyles.action,
              accordionStyles.actionBorderless,
            )}
          >
            <Flexbox horizontal align="center" gap={2}>
              <ToggleGroups />
              <Filter />
              <Actions />
            </Flexbox>
          </div>
        </AccordionHeader>
      </ContextMenuTrigger>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Suspense fallback={<SkeletonList />}>
          <Flexbox gap={1} paddingBlock={1}>
            <List />
          </Flexbox>
        </Suspense>
      </AccordionPanel>
    </AccordionItem>
  );
});

export default Topic;
