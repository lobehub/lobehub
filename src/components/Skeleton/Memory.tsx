'use client';

import { Flexbox } from '@lobehub/ui';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

const MemorySkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'}>
    {chrome !== 'body' && <NavHeader />}
    <Flexbox height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <WideScreenContainer gap={32} paddingBlock={48}>
        <SkeletonBar height={400} radius={12} />
        <Flexbox gap={16}>
          <SkeletonBar height={32} width={120} />
          <SkeletonBar height={64} radius={8} />
        </Flexbox>
        <Flexbox gap={16}>
          <SkeletonBar height={44} width={160} />
          <SkeletonBar height={16} />
          <SkeletonBar height={16} width={'92%'} />
          <SkeletonBar height={16} width={'60%'} />
        </Flexbox>
      </WideScreenContainer>
    </Flexbox>
  </Flexbox>
);

export default MemorySkeleton;
