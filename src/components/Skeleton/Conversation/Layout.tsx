'use client';

import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';

import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from '../Bar';
import ConversationSegmentSkeleton from './Segment';

interface ConversationLayoutSkeletonProps extends RouteSkeletonProps {
  aside?: ReactNode;
}

const ConversationLayoutSkeleton = ({ aside }: ConversationLayoutSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <Flexbox
      horizontal
      align={'center'}
      flex={'none'}
      height={44}
      justify={'space-between'}
      paddingInline={12}
    >
      <SkeletonBar height={24} width={144} />
      <SkeletonBar height={28} width={72} />
    </Flexbox>
    {aside ? (
      <Flexbox horizontal flex={1} style={{ minHeight: 0, minWidth: 0 }}>
        <Flexbox flex={1} style={{ minHeight: 0, minWidth: 0 }}>
          <ConversationSegmentSkeleton />
        </Flexbox>
        {aside}
      </Flexbox>
    ) : (
      <ConversationSegmentSkeleton />
    )}
  </Flexbox>
);

export default ConversationLayoutSkeleton;
