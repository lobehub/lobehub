'use client';

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import { useDeferredMount } from '@/hooks/useDeferredMount';
import { useFetchActiveTopicDetail } from '@/hooks/useFetchActiveTopicDetail';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

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
  const topicLength = useChatStore((s) => topicSelectors.currentTopicLength(s));
  const isUndefinedTopics = useChatStore((s) => topicSelectors.isUndefinedTopics(s));

  const [agentId, allTopicsDrawerOpen, closeAllTopicsDrawer] = useChatStore((s) => [
    s.activeAgentId,
    s.allTopicsDrawerOpen,
    s.closeAllTopicsDrawer,
  ]);

  const { topicGroupMode } = useAgentTopicGroupMode();

  useFetchChatTopics();
  useFetchActiveTopicDetail();

  // Route transitions must paint instantly: the mount commit shows a skeleton
  // frame and the real list renders in a deferred (interruptible) follow-up
  // pass, off the navigation's critical path.
  const listReady = useDeferredMount();

  // Show skeleton when current session's topic data is not yet loaded
  if (isUndefinedTopics || !listReady) return <TopicListSkeleton />;

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
