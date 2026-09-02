'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';

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
      <Skeleton.Paragraph active rows={3} style={{ alignItems: 'flex-end' }} />
    </Flexbox>
    {Array.from({ length: 2 }).map((_, index) => (
      <Flexbox gap={8} key={index} width={'100%'}>
        <Skeleton active avatar={{ shape: 'square', size: 28 }} paragraph={false} />
        <Skeleton.Paragraph />
        <Skeleton.Tags count={2} />
      </Flexbox>
    ))}
  </ConversationSkeletonContainer>
);

export default ConversationListSkeleton;
