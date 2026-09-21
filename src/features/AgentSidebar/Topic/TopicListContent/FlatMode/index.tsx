'use client';

import { Flexbox } from '@lobehub/ui';
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
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { useScrollActiveTopicIntoView } from '../../hooks/useScrollActiveTopicIntoView';
import { useNavigateToAgentTopics } from '../../hooks/useTopicNavigation';
import TopicItem from '../../List/Item';
import { useScopedSidebarTopics } from '../../useScopedTopics';

const FlatMode = memo(() => {
  const { t } = useTranslation('chat');
  const navigateToAgentTopics = useNavigateToAgentTopics();
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const topicIncludeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);

  const [hasMore, isExpandingPageSize, activeAgentId, agentActiveTopicId] = useChatStore((s) => [
    topicSelectors.hasMoreTopicsForSidebar(s),
    topicSelectors.isExpandingPageSize(s),
    s.activeAgentId,
    s.activeTopicId,
  ]);

  const agentTopicList = useChatStore(
    topicSelectors.displayTopicsForSidebar(topicPageSize, topicSortBy, topicIncludeCompleted),
    isEqual,
  );
  const scoped = useScopedSidebarTopics(topicPageSize, topicSortBy, 'flat', topicIncludeCompleted);
  const activeTopicList = scoped.scope ? scoped.topics : agentTopicList;
  const activeTopicId = scoped.scope ? scoped.activeTopicId : agentActiveTopicId;
  const renderedTopicIds = useMemo(
    () => activeTopicList?.map((topic) => topic.id).join(':') ?? '',
    [activeTopicList],
  );
  const listRef = useScrollActiveTopicIntoView(activeTopicId, renderedTopicIds);

  return (
    <Flexbox gap={1} ref={listRef}>
      {activeTopicList?.map((topic) => (
        <TopicItem
          fav={topic.favorite}
          id={topic.id}
          key={topic.id}
          metadata={topic.metadata}
          runStartedAt={topic.runStartedAt}
          status={topic.status}
          title={topic.title}
          userId={topic.userId}
        />
      ))}
      {scoped.scope && scoped.hasMore && (
        <NavItem icon={MoreHorizontal} title={t('topic.viewAll')} onClick={scoped.loadMore} />
      )}
      {!scoped.scope && isExpandingPageSize && <SkeletonList rows={3} />}
      {!scoped.scope && hasMore && !isExpandingPageSize && activeAgentId && (
        <NavItem
          icon={MoreHorizontal}
          title={t('topic.viewAll')}
          onClick={() => navigateToAgentTopics(activeAgentId)}
        />
      )}
    </Flexbox>
  );
});

FlatMode.displayName = 'FlatMode';

export default FlatMode;
