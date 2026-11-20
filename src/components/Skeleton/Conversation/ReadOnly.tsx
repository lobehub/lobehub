'use client';

import { Flexbox } from '@lobehub/ui';

import SkeletonBar from '../Bar';
import ConversationListSkeleton from './List';

/** A read-only transcript page: a header naming the conversation over its messages, no composer. */
const ReadOnlyConversationSkeleton = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <Flexbox horizontal align={'center'} gap={8} height={44} paddingInline={16}>
      <SkeletonBar height={20} radius={'50%'} width={20} />
      <SkeletonBar height={14} width={160} />
    </Flexbox>
    <ConversationListSkeleton />
  </Flexbox>
);

export default ReadOnlyConversationSkeleton;
