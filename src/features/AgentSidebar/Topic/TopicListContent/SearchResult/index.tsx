'use client';

import { Center, Text } from '@lobehub/ui';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useChatTopicSearchProjection } from '@/projection';
import { useChatStore } from '@/store/chat';

import TopicItem from '../../List/Item';

const SearchResult = memo(() => {
  const { t } = useTranslation('topic');
  const [activeAgentId, keywords] = useChatStore((state) => [
    state.activeAgentId,
    state.topicSearchKeywords,
  ]);
  const { data: topics = [], isLoading } = useChatTopicSearchProjection(keywords || undefined, {
    agentId: activeAgentId,
  });

  if (isLoading) return <SkeletonList />;

  if (topics.length === 0)
    return (
      <Center paddingBlock={12}>
        <Text type={'secondary'}>{t('searchResultEmpty')}</Text>
      </Center>
    );

  return (
    <>
      {topics.map((topic) => (
        <TopicItem
          fav={topic.favorite}
          id={topic.id}
          key={topic.id}
          metadata={topic.metadata}
          status={topic.status}
          title={topic.title}
          userId={topic.userId}
        />
      ))}
    </>
  );
});

SearchResult.displayName = 'SearchResult';

export default SearchResult;
