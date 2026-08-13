'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useTopicGroupCollapse } from '@/hooks/useTopicGroupCollapse';
import { useChatStore } from '@/store/chat';
import {
  useCurrentChatTopics,
  useGroupedChatTopicsForSidebar,
} from '@/store/chat/slices/topic/projection';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import GroupItem from './GroupItem';

const ByTimeMode = memo(() => {
  const { t } = useTranslation('topic');
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const topicGroupMode = useUserStore(preferenceSelectors.topicGroupMode);
  const topicIncludeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);

  const openAllTopicsDrawer = useChatStore((state) => state.openAllTopicsDrawer);
  const [activeTopicId, activeThreadId] = useChatStore((s) => [s.activeTopicId, s.activeThreadId]);
  const topicView = useCurrentChatTopics();
  const hasMore = Boolean(topicView?.hasMore || (topicView?.total ?? 0) > topicPageSize);
  const { isExpandingPageSize } = useFetchChatTopics();
  const groupTopics = useGroupedChatTopicsForSidebar(
    topicPageSize,
    topicSortBy,
    topicGroupMode,
    topicIncludeCompleted,
  );

  const groupIds = useMemo(() => groupTopics.map((group) => group.id), [groupTopics]);
  const { expandedKeys, setExpandedKeys } = useTopicGroupCollapse(topicGroupMode, groupIds);

  return (
    <Flexbox gap={2}>
      {/* Grouped topics */}
      <Accordion
        expandedKeys={expandedKeys}
        gap={2}
        onExpandedChange={(keys) => setExpandedKeys(keys as string[])}
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
