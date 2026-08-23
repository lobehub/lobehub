'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

const GoalDetailContentSkeleton = () => (
  <Flexbox aria-busy gap={20} paddingBlock={8}>
    <Flexbox gap={10}>
      <SkeletonBar height={28} width={'52%'} />
      <SkeletonBar height={14} width={'78%'} />
    </Flexbox>
    <Flexbox horizontal gap={18}>
      {Array.from({ length: 4 }).map((_, index) => (
        <Flexbox gap={6} key={index} width={112}>
          <SkeletonBar height={22} width={index === 0 ? 68 : 52} />
          <SkeletonBar height={12} width={76} />
        </Flexbox>
      ))}
    </Flexbox>
    <SkeletonBar height={96} radius={cssVar.borderRadiusLG} />
    <Flexbox gap={12}>
      <SkeletonBar height={18} width={128} />
      <SkeletonBar height={42} radius={cssVar.borderRadiusLG} />
      <SkeletonBar height={42} radius={cssVar.borderRadiusLG} />
      <SkeletonBar height={42} radius={cssVar.borderRadiusLG} />
    </Flexbox>
  </Flexbox>
);

const GoalDetailSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox flex={1} height={'100%'}>
    {chrome !== 'body' && <NavHeader />}
    <Flexbox flex={1} style={{ overflowY: 'auto' }}>
      <WideScreenContainer gap={20} paddingBlock={16}>
        <GoalDetailContentSkeleton />
      </WideScreenContainer>
    </Flexbox>
  </Flexbox>
);

export default GoalDetailSkeleton;
