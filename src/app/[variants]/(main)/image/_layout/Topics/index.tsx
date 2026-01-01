'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Flexbox } from '@lobehub/ui';
import { useSize } from 'ahooks';
import { memo, useRef } from 'react';

import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import NewTopicButton from './NewTopicButton';
import TopicItem from './TopicItem';

const TopicsList = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchGenerationTopics = useImageStore((s) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);
  const ref = useRef(null);
  const { width = 80 } = useSize(ref) || {};
  const [parent] = useAutoAnimate();
  const generationTopics = useImageStore(generationTopicSelectors.generationTopics);
  const openNewGenerationTopic = useImageStore((s) => s.openNewGenerationTopic);

  const showMoreInfo = Boolean(width > 120);

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
      style={{
        maxHeight: '100%',
        overflowY: 'auto',
      }}
      width={'100%'}
    >
      <NewTopicButton
        count={generationTopics?.length}
        onClick={openNewGenerationTopic}
        showMoreInfo={showMoreInfo}
      />
      <Flexbox align="center" gap={12} ref={parent} width={'100%'}>
        {generationTopics.map((topic, index) => (
          <TopicItem
            key={topic.id}
            showMoreInfo={showMoreInfo}
            style={{
              padding:
                // fix the avatar border is clipped by overflow hidden
                generationTopics.length === 1
                  ? '4px 0'
                  : index === generationTopics.length - 1
                    ? '0 0 4px'
                    : '0',
            }}
            topic={topic}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

TopicsList.displayName = 'TopicsList';

export default TopicsList;
