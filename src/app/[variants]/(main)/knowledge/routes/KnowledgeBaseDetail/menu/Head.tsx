'use client';

import { Text } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import RepoIcon from '@/components/RepoIcon';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/knowledgeBase';

import GoBack from '../../../components/GoBack';

const Head = memo<{ id: string }>(({ id }) => {
  const name = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseNameById(id));

  return (
    <Flexbox gap={8}>
      <GoBack to="/" />
      <Flexbox align={'center'} gap={8} height={36} horizontal>
        <Center style={{ minWidth: 24 }} width={24}>
          <RepoIcon />
        </Center>

        {!name ? (
          <Skeleton active paragraph={false} title={{ style: { marginBottom: 0 }, width: 80 }} />
        ) : (
          <Text ellipsis strong style={{ fontSize: 16 }}>
            {name}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );
});

Head.displayName = 'Head';

export default Head;
