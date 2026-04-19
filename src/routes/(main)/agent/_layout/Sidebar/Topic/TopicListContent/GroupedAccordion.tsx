'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import { type ComponentType, memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { type GroupedTopic } from '@/types/topic';

export interface GroupItemComponentProps {
  activeThreadId?: string;
  activeTopicId?: string;
  group: GroupedTopic;
}

interface GroupedAccordionProps {
  GroupItem: ComponentType<GroupItemComponentProps>;
}

const GroupedAccordion = memo<GroupedAccordionProps>(({ GroupItem }) => {
  const { t } = useTranslation('topic');
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const topicGroupMode = useUserStore(preferenceSelectors.topicGroupMode);

  const [hasMore, isExpandingPageSize, openAllTopicsDrawer] = useChatStore((s) => [
    topicSelectors.hasMoreTopics(s),
    topicSelectors.isExpandingPageSize(s),
    s.openAllTopicsDrawer,
  ]);
  const [activeTopicId, activeThreadId] = useChatStore((s) => [s.activeTopicId, s.activeThreadId]);

  const groupSelector = useMemo(
    () => topicSelectors.groupedTopicsForSidebar(topicPageSize, topicSortBy, topicGroupMode),
    [topicPageSize, topicSortBy, topicGroupMode],
  );
  const groupTopics = useChatStore(groupSelector, isEqual);

  const [topicGroupKeys, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.topicGroupKeys(s),
    s.updateSystemStatus,
  ]);

  useEffect(() => {
    updateSystemStatus({ expandTopicGroupKeys: undefined });
  }, [topicSortBy, topicGroupMode, updateSystemStatus]);

  const expandedKeys = useMemo(
    () => topicGroupKeys || groupTopics.map((group) => group.id),
    [topicGroupKeys, groupTopics],
  );

  return (
    <Flexbox gap={2}>
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

GroupedAccordion.displayName = 'GroupedAccordion';

export default GroupedAccordion;
