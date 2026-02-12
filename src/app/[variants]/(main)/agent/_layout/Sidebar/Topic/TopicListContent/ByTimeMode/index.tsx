'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import GroupItem from './GroupItem';

const ByTimeMode = memo(() => {
  const { t } = useTranslation('topic');
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);

  const [hasMore, isExpandingPageSize, openAllTopicsDrawer] = useChatStore((s) => [
    topicSelectors.hasMoreTopics(s),
    topicSelectors.isExpandingPageSize(s),
    s.openAllTopicsDrawer,
  ]);
  const [activeTopicId, activeThreadId] = useChatStore((s) => [s.activeTopicId, s.activeThreadId]);
  const groupTopics = useChatStore(topicSelectors.groupedTopicsForSidebar(topicPageSize), isEqual);

  const [topicGroupKeys, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.topicGroupKeys(s),
    s.updateSystemStatus,
  ]);

  const expandedKeys = useMemo(() => {
    return topicGroupKeys || groupTopics.map((group) => group.id);
  }, [topicGroupKeys, groupTopics]);

  return (
    <Flexbox gap={2}>
      {/* Grouped topics */}
      <Accordion
        expandedKeys={expandedKeys}
        gap={2}
        onExpandedChange={(keys) => updateSystemStatus({ expandTopicGroupKeys: keys as any })}
      >
        {groupTopics.map((group) => (
          <GroupItem
            activeThreadId={activeThreadId}
            activeTopicId={activeTopicId}
            group={group}
            key={group.id}
          />
        ))}
      </Accordion>
      {isExpandingPageSize && <SkeletonList rows={3} />}
      {hasMore && !isExpandingPageSize && (
        <NavItem icon={MoreHorizontal} title={t('loadMore')} onClick={openAllTopicsDrawer} />
      )}
    </Flexbox>
  );
});

ByTimeMode.displayName = 'ByTimeMode';

export default ByTimeMode;
