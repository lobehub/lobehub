'use client';

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import ByProjectMode from './ByProjectMode';
import ByTimeMode from './ByTimeMode';
import FlatMode from './FlatMode';
import SearchResult from './SearchResult';

const TopicListContent = memo(() => {
  const { t } = useTranslation('topic');
  const router = useQueryRoute();
  const topicLength = useChatStore((s) => topicSelectors.currentTopicLength(s));
  const [agentId, isUndefinedTopics, isInSearchMode] = useChatStore((s) => [
    s.activeAgentId,
    topicSelectors.isUndefinedTopics(s),
    topicSelectors.isInSearchMode(s),
  ]);

  const topicGroupMode = useUserStore(preferenceSelectors.topicGroupMode);

  useFetchChatTopics();

  if (isInSearchMode) return <SearchResult />;

  // Show skeleton when current session's topic data is not yet loaded
  if (isUndefinedTopics) return <SkeletonList />;

  return (
    <>
      {topicLength === 0 && (
        <EmptyNavItem
          title={t('actions.addNewTopic')}
          onClick={() => {
            router.push(urlJoin('/agent', agentId));
          }}
        />
      )}
      {topicGroupMode === 'flat' ? (
        <FlatMode />
      ) : topicGroupMode === 'byProject' ? (
        <ByProjectMode />
      ) : (
        <ByTimeMode />
      )}
    </>
  );
});

TopicListContent.displayName = 'TopicListContent';

export default TopicListContent;
