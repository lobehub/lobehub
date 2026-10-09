'use client';

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import { useFetchActiveTopicDetail } from '@/hooks/useFetchActiveTopicDetail';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import AllTopicsDrawer from '../AllTopicsDrawer';
import { useAgentTopicGroupMode } from '../hooks/useAgentTopicGroupMode';
import ByAgentMode from '../TopicListContent/ByAgentMode';
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

  // The agent route loader seeds this session's persisted page before the layout
  // commits (`agentChatTopicListLoader`), so a frame painted here already has
  // rows. The skeleton is left for the cases that genuinely have nothing
  // persisted yet, or a storage read that never lands — never as a mount tax.
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
      ) : topicGroupMode === 'byAgent' ? (
        <ByAgentMode />
      ) : (
        <ByTimeMode />
      )}
      <AllTopicsDrawer open={allTopicsDrawerOpen} onClose={closeAllTopicsDrawer} />
    </>
  );
});

export default TopicList;
