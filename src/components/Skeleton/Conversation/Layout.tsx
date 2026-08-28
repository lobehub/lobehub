'use client';

import { Flexbox } from '@lobehub/ui';

import SkeletonBar from '../Bar';
import ConversationSegmentSkeleton from './Segment';

const ConversationLayoutSkeleton = () => (
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
    <ConversationSegmentSkeleton />
  </Flexbox>
);

export default ConversationLayoutSkeleton;
