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
        <Flexbox align={'center'} gap={16} paddingBlock={'18vh 0'}>
          <SkeletonBar height={44} radius={'50%'} width={44} />
          <Flexbox align={'center'} gap={10} width={'min(520px, 80%)'}>
            <SkeletonBar height={24} width={132} />
            <SkeletonBar height={14} width={'88%'} />
            <SkeletonBar height={14} width={'64%'} />
            <SkeletonBar height={32} width={128} />
          </Flexbox>
        </Flexbox>
      </WideScreenContainer>
    </Flexbox>
  </Flexbox>
);

export default MemorySkeleton;
