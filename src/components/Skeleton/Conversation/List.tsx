'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';

import { ArticleSkeleton } from '@/components/Skeleton';

import ConversationSkeletonContainer from './Container';

const ConversationListSkeleton = () => (
  <ConversationSkeletonContainer
    flex={1}
    gap={36}
    height={'100%'}
    padding={12}
    style={{ marginTop: 24 }}
  >
    <Flexbox gap={8} style={{ paddingLeft: '25%' }} width={'100%'}>
      <Skeleton.Text rows={3} style={{ alignItems: 'flex-end' }} />
    </Flexbox>
    {Array.from({ length: 2 }).map((_, index) => (
      <Flexbox gap={8} key={index} width={'100%'}>
        <ArticleSkeleton avatar={28} rows={0} />
        <Skeleton.Text />
        <Flexbox horizontal gap={8}>
          <Skeleton height={22} radius={4} width={48} />
          <Skeleton height={22} radius={4} width={48} />
        </Flexbox>
      </Flexbox>
    ))}
  </ConversationSkeletonContainer>
);

export default ConversationListSkeleton;
