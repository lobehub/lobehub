'use client';

import { Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useChatStore } from '@/store/chat';
import {
  displayChatTopicsForSidebar,
  useCurrentChatTopics,
} from '@/store/chat/slices/topic/projection';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import TopicItem from '../../List/Item';

const FlatMode = memo(() => {
  const { t } = useTranslation('topic');
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const topicIncludeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);

  const [activeTopicId, activeThreadId, openAllTopicsDrawer] = useChatStore((s) => [
    s.activeTopicId,
    s.activeThreadId,
    s.openAllTopicsDrawer,
  ]);
  const topicView = useCurrentChatTopics();
  const hasMore = Boolean(topicView?.hasMore || (topicView?.total ?? 0) > topicPageSize);
  const { isExpandingPageSize } = useFetchChatTopics();
  const activeTopicList = displayChatTopicsForSidebar(
    topicView?.items,
    topicPageSize,
    topicSortBy,
    topicIncludeCompleted,
  );

  return (
    <Flexbox gap={1}>
      {activeTopicList?.map((topic) => (
        <TopicItem
          active={activeTopicId === topic.id}
          id={topic.id}
          key={topic.id}
          status={topic.status}
          threadId={activeThreadId}
          title={topic.title}
          userId={topic.userId}
        />
      ))}
      {isExpandingPageSize && <SkeletonList rows={3} />}
      {hasMore && !isExpandingPageSize && (
        <NavItem icon={MoreHorizontal} title={t('loadMore')} onClick={openAllTopicsDrawer} />
      )}
    </Flexbox>
  );
});

FlatMode.displayName = 'FlatMode';

export default FlatMode;
