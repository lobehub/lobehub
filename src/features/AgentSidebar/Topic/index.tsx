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
import React, { memo, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useChatStore } from '@/store/chat';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';

import Actions from './Actions';
import Filter from './Filter';
import List from './List';
import ToggleGroups from './ToggleGroups';
import { useTopicActionsDropdownMenu } from './useDropdownMenu';

/**
 * Cadence of the candidate-gated stale-run sweep. A run whose terminal frame
 * never landed leaves this tab holding a `running` op, so the topic row spins
 * and counts over a finished topic; this is how long that may last before the
 * row is retired. Only armed while `hasVisiblyRunningTopic` is true.
 */
const STALE_RUNNING_TOPIC_SWEEP_INTERVAL = 15_000;

interface TopicProps {
  expanded: boolean;
  itemKey: string;
}

const Topic = memo<TopicProps>(({ expanded, itemKey }) => {
  const { t } = useTranslation(['topic', 'common']);
  const topicCount = useChatStore((s) => topicSelectors.currentTopicCount(s));
  const cleanupStaleRunningTopics = useChatStore((s) => s.cleanupStaleRunningTopics);
  const settleAllUnbackedTopicRuns = useChatStore((s) => s.settleAllUnbackedTopicRuns);
  const hasVisiblyRunningTopic = useChatStore(operationSelectors.hasVisiblyRunningTopic);
  const dropdownMenu = useTopicActionsDropdownMenu();
  const { isRevalidating } = useFetchChatTopics();

  // Sweep on EVERY expand, not once per session. A latched watchdog missed every
  // run that leaked its terminal frame after it had already fired, and such a row
  // then spun and counted over a finished topic until a full reload.
  useEffect(() => {
    if (!expanded) return;

    void cleanupStaleRunningTopics();
  }, [cleanupStaleRunningTopics, expanded]);

  // Keep retiring whatever the server no longer backs for as long as a row still
  // reports itself running. The sweep returns before any server read when there
  // is no candidate, so this only polls while a row is actually stuck — or
  // genuinely mid-run.
  useEffect(() => {
    if (!expanded || !hasVisiblyRunningTopic) return;

    const sweep = () => void settleAllUnbackedTopicRuns().catch(console.error);
    sweep();
    const timer = setInterval(sweep, STALE_RUNNING_TOPIC_SWEEP_INTERVAL);

    return () => clearInterval(timer);
  }, [expanded, hasVisiblyRunningTopic, settleAllUnbackedTopicRuns]);

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
              {isRevalidating && <Spin size="small" variant="network" />}
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
