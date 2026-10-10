'use client';

import { Flexbox } from '@lobehub/ui';
import { AccordionRoot } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useTopicGroupCollapse } from '@/hooks/useTopicGroupCollapse';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import GroupItem from './GroupItem';
import { resolveGroupSidebarMode } from './resolveGroupSidebarMode';

const ByTimeMode = memo(() => {
  const { t } = useTranslation('topic');
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const topicGroupMode = useUserStore(preferenceSelectors.topicGroupMode);
  const topicIncludeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);
  const groupMode = resolveGroupSidebarMode(topicGroupMode);

  const [hasMore, isExpandingPageSize, openAllTopicsDrawer] = useChatStore((s) => [
    topicSelectors.hasMoreTopicsForSidebar(s),
    topicSelectors.isExpandingPageSize(s),
    s.openAllTopicsDrawer,
  ]);
  const [activeTopicId, activeThreadId] = useChatStore((s) => [s.activeTopicId, s.activeThreadId]);

  const groupSelector = useMemo(
    () =>
      topicSelectors.groupedTopicsForSidebar(
        topicPageSize,
        topicSortBy,
        groupMode,
        topicIncludeCompleted,
      ),
    [topicPageSize, topicSortBy, groupMode, topicIncludeCompleted],
  );
  const groupTopics = useChatStore(groupSelector, isEqual);

  const groupIds = useMemo(() => groupTopics.map((group) => group.id), [groupTopics]);
  const { expandedKeys, setExpandedKeys } = useTopicGroupCollapse(groupMode, groupIds);

  return (
    <Flexbox gap={2}>
      {/* Grouped topics */}
      <AccordionRoot
        indicatorPlacement="inline"
        style={{ gap: 2 }}
        value={expandedKeys}
        onValueChange={(next) => setExpandedKeys(next as string[])}
      >
        {groupTopics.map((group) => (
          <GroupItem
            activeThreadId={activeThreadId}
            activeTopicId={activeTopicId}
            group={group}
            key={group.id}
          />
        ))}
      </AccordionRoot>
      {isExpandingPageSize && <SkeletonList rows={3} />}
      {hasMore && !isExpandingPageSize && (
        <NavItem icon={MoreHorizontal} title={t('loadMore')} onClick={openAllTopicsDrawer} />
      )}
    </Flexbox>
  );
});

ByTimeMode.displayName = 'ByTimeMode';

export default ByTimeMode;
