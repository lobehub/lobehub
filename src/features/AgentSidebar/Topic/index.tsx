'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ContextMenuTrigger,
  cx,
  Flexbox,
  Spin,
  Text,
} from '@lobehub/ui';
import { useDocumentVisibility } from 'ahooks';
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

/**
 * Ceiling the cadence backs off to while a sweep keeps retiring nothing — i.e.
 * while the run it is looking at is genuinely alive. An ordinary long run must
 * not be polled at the leak-hunting cadence for its whole duration.
 */
const STALE_RUNNING_TOPIC_SWEEP_MAX_INTERVAL = 120_000;

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
  // A hidden tab has nothing to repaint, so polling the server for it would buy
  // nothing — and the sweep re-runs on the next visibility change anyway.
  const documentVisibility = useDocumentVisibility();
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
  // is no candidate, so this only runs while a row is stuck — or genuinely
  // mid-run. Serialized (never two sweeps in flight), paused while the document
  // is hidden, and backed off while a sweep retires nothing, so an ordinary long
  // run is not polled at the leak-hunting cadence.
  useEffect(() => {
    if (!expanded || documentVisibility === 'hidden' || !hasVisiblyRunningTopic) return;

    let cancelled = false;
    let inFlight = false;
    let delay = STALE_RUNNING_TOPIC_SWEEP_INTERVAL;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      timer = setTimeout(sweep, delay);
    };

    const sweep = async () => {
      if (cancelled || inFlight) return;

      inFlight = true;
      try {
        const settled = await settleAllUnbackedTopicRuns();
        // Retiring nothing means the run is alive: back off rather than keep
        // paying the per-topic detail read. Any settlement resets the cadence.
        delay =
          settled > 0
            ? STALE_RUNNING_TOPIC_SWEEP_INTERVAL
            : Math.min(delay * 2, STALE_RUNNING_TOPIC_SWEEP_MAX_INTERVAL);
      } catch (error) {
        console.error('[Topic] unbacked run sweep failed:', error);
      } finally {
        inFlight = false;
        if (!cancelled) schedule();
      }
    };

    void sweep();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [documentVisibility, expanded, hasVisiblyRunningTopic, settleAllUnbackedTopicRuns]);

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
