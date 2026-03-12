'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Flexbox } from '@lobehub/ui';
import { useSize } from 'ahooks';
import { memo, useRef } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { useGenerationTopicContext } from './StoreContext';
import TopicItem from './TopicItem';

interface TopicListProps {
  viewMode?: 'auto' | 'grid' | 'list';
}

const TopicsList = memo<TopicListProps>(({ viewMode = 'auto' }) => {
  const { useStore } = useGenerationTopicContext();
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchGenerationTopics = useStore((s) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);
  const ref = useRef(null);
  const { width = 80 } = useSize(ref) || {};
  const [parent] = useAutoAnimate();
  const generationTopics = useStore((s) => s.generationTopics);

  const showMoreInfo =
    viewMode === 'list' ? true : viewMode === 'grid' ? false : Boolean(width > 120);

  const isEmpty = !generationTopics || generationTopics.length === 0;
  if (isEmpty) {
    return null;
  }

  return (
    <Flexbox
      align="center"
      gap={12}
      padding={12}
      ref={ref}
      width={'100%'}
      style={{
        maxHeight: '100%',
        overflowY: 'auto',
      }}
    >
      <Flexbox align="center" gap={12} ref={parent} width={'100%'}>
        {generationTopics.map((topic, index) => (
          <TopicItem
            key={topic.id}
            showMoreInfo={showMoreInfo}
            topic={topic}
            style={{
              padding:
                generationTopics.length === 1
                  ? '4px 0'
                  : index === generationTopics.length - 1
                    ? '0 0 4px'
                    : '0',
            }}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

TopicsList.displayName = 'TopicsList';

export default TopicsList;
