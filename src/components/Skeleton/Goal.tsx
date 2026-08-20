'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

const styles = createStaticStyles(({ css }) => ({
  listRows: css`
    display: flex;
    flex-direction: column;
    border-block: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const GoalSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'}>
    {chrome !== 'body' && <NavHeader />}
    <WideScreenContainer
      flex={1}
      gap={20}
      paddingBlock={16}
      wrapperStyle={{ flex: 1, overflowY: 'auto' }}
    >
      <Flexbox horizontal align={'center'} justify={'space-between'} paddingBlock={'6px 18px'}>
        <Flexbox gap={6}>
          <SkeletonBar height={20} width={160} />
          <SkeletonBar height={14} width={280} />
        </Flexbox>
        <Flexbox horizontal gap={20}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Flexbox gap={5} key={index} width={88}>
              <SkeletonBar height={20} width={32} />
              <SkeletonBar height={12} width={56} />
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
      <Flexbox gap={10}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <SkeletonBar height={18} width={112} />
          <Flexbox horizontal gap={8}>
            <SkeletonBar height={28} width={112} />
            <SkeletonBar height={28} width={64} />
          </Flexbox>
        </Flexbox>
        <Flexbox className={styles.listRows}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Flexbox horizontal align={'center'} gap={12} key={index} paddingBlock={14}>
              <SkeletonBar height={20} radius={'50%'} width={20} />
              <Flexbox flex={1} gap={7}>
                <SkeletonBar height={16} width={`${36 + index * 8}%`} />
                <SkeletonBar height={12} width={`${54 + index * 6}%`} />
              </Flexbox>
              <SkeletonBar height={24} width={72} />
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    </WideScreenContainer>
  </Flexbox>
);

export default GoalSkeleton;
