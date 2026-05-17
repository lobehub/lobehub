'use client';

import React, { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { type SideBarDrawerHandle } from '@/features/NavPanel/SideBarDrawer';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import AllTopicsDrawer from '../AllTopicsDrawer';
import { useAgentTopicGroupMode } from '../hooks/useAgentTopicGroupMode';
import ByProjectMode from '../TopicListContent/ByProjectMode';
import ByTimeMode from '../TopicListContent/ByTimeMode';
import FlatMode from '../TopicListContent/FlatMode';

const TopicList = memo(() => {
  const { t } = useTranslation('topic');
  const router = useQueryRoute();
  const topicLength = useChatStore((s) => topicSelectors.currentTopicLength(s));
  const isUndefinedTopics = useChatStore((s) => topicSelectors.isUndefinedTopics(s));

  const agentId = useChatStore((s) => s.activeAgentId);

  const { topicGroupMode } = useAgentTopicGroupMode();

  const drawerRef = useRef<SideBarDrawerHandle>(null);
  const openDrawer = useCallback(() => drawerRef.current?.open(), []);

  useFetchChatTopics();

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
        <FlatMode onOpenDrawer={openDrawer} />
      ) : topicGroupMode === 'byProject' ? (
        <ByProjectMode onOpenDrawer={openDrawer} />
      ) : (
        <ByTimeMode onOpenDrawer={openDrawer} />
      )}
      <AllTopicsDrawer ref={drawerRef} />
    </>
  );
});

export default TopicList;
