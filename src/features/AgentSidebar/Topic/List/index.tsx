'use client';

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { topicsWithoutCron, useCurrentChatTopics } from '@/store/chat/slices/topic/projection';

import AllTopicsDrawer from '../AllTopicsDrawer';
import { useAgentTopicGroupMode } from '../hooks/useAgentTopicGroupMode';
import ByProjectMode from '../TopicListContent/ByProjectMode';
import ByStatusMode from '../TopicListContent/ByStatusMode';
import ByTimeMode from '../TopicListContent/ByTimeMode';
import FlatMode from '../TopicListContent/FlatMode';
import TopicListSkeleton from './TopicListSkeleton';

const TopicList = memo(() => {
  const { t } = useTranslation('topic');
  const router = useQueryRoute();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const topicView = useCurrentChatTopics();
  const topicLength = topicsWithoutCron(topicView?.items)?.length ?? 0;
  const isUndefinedTopics = !topicView;

  const [agentId, allTopicsDrawerOpen, closeAllTopicsDrawer] = useChatStore((s) => [
    s.activeAgentId,
    s.allTopicsDrawerOpen,
    s.closeAllTopicsDrawer,
  ]);

  const { topicGroupMode } = useAgentTopicGroupMode();

  useFetchChatTopics();

  // Show skeleton when current session's topic data is not yet loaded
  if (isUndefinedTopics) return <TopicListSkeleton />;

  return (
    <>
      {topicLength === 0 && (
        <EmptyNavItem
          disabled={!canCreateTopic}
          title={t('actions.addNewTopic')}
          onClick={() => {
            if (!canCreateTopic) return;
            router.push(urlJoin('/agent', agentId));
          }}
        />
      )}
      {topicGroupMode === 'flat' ? (
        <FlatMode />
      ) : topicGroupMode === 'byProject' ? (
        <ByProjectMode />
      ) : topicGroupMode === 'byStatus' ? (
        <ByStatusMode />
      ) : (
        <ByTimeMode />
      )}
      <AllTopicsDrawer open={allTopicsDrawerOpen} onClose={closeAllTopicsDrawer} />
    </>
  );
});

export default TopicList;
