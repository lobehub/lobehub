'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import TopicItem from '../../List/Item';

const FlatMode = memo(() => {
  const { t } = useTranslation('topic');
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);

  const [activeTopicId, activeThreadId, hasMore, isExpandingPageSize, openAllTopicsDrawer] =
    useChatStore((s) => [
      s.activeTopicId,
      s.activeThreadId,
      topicSelectors.hasMoreTopics(s),
      topicSelectors.isExpandingPageSize(s),
      s.openAllTopicsDrawer,
    ]);

  const activeTopicList = useChatStore(
    topicSelectors.displayTopicsForSidebar(topicPageSize, topicSortBy),
    isEqual,
  );

  return (
    <Flexbox gap={1}>
      {activeTopicList?.map((topic) => (
        <TopicItem
          active={activeTopicId === topic.id}
          fav={topic.favorite}
          id={topic.id}
          key={topic.id}
          metadata={topic.metadata}
          status={topic.status}
          threadId={activeThreadId}
          title={topic.title}
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
