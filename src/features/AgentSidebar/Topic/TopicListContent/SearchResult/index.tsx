'use client';

import { Center } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import TopicItem from '../../List/Item';

const SearchResult = memo(() => {
  const { t } = useTranslation('topic');
  const isSearchingTopic = useChatStore((s) => topicSelectors.isSearchingTopic(s));
  const topics = useChatStore(topicSelectors.searchTopics, isEqual);

  if (isSearchingTopic) return <SkeletonList />;

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
