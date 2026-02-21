'use client';

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { TopicDisplayMode } from '@/types/topic';

import AllTopicsDrawer from '../AllTopicsDrawer';
import ByTimeMode from '../TopicListContent/ByTimeMode';
import FlatMode from '../TopicListContent/FlatMode';

const fetchParams = { excludeTriggers: ['cron'] };

const TopicList = memo(() => {
  const { t } = useTranslation('topic');
  const router = useQueryRoute();
  const topicLength = useChatStore((s) => topicSelectors.currentTopicLength(s));
  const isUndefinedTopics = useChatStore((s) => topicSelectors.isUndefinedTopics(s));

  const [agentId, allTopicsDrawerOpen, closeAllTopicsDrawer] = useChatStore((s) => [
    s.activeAgentId,
    s.allTopicsDrawerOpen,
    s.closeAllTopicsDrawer,
  ]);

  const [topicDisplayMode] = useUserStore((s) => [preferenceSelectors.topicDisplayMode(s)]);

  useFetchTopics(fetchParams);

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
      {topicDisplayMode === TopicDisplayMode.ByTime ? <ByTimeMode /> : <FlatMode />}
      <AllTopicsDrawer open={allTopicsDrawerOpen} onClose={closeAllTopicsDrawer} />
    </>
  );
});

export default TopicList;
