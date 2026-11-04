'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';

import NavHeader from '@/features/NavHeader';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

const styles = stylex.create({
  card: {
    minHeight: '140px',
    padding: '14px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  footer: {
    marginBlockStart: 'auto',
    paddingBlockStart: '10px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorSplit,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
      [media.md]: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
    },
    gap: '12px',
    width: '100%',
    minWidth: '0',
  },
});

const TopicCardSkeleton = ({ index }: { index: number }) => (
  <Flexbox className={stylex.props(styles.card).className} gap={10}>
    <Flexbox horizontal align={'center'} gap={8}>
      <SkeletonBar height={8} radius={'50%'} width={8} />
      <SkeletonBar height={16} width={`${46 + (index % 3) * 10}%`} />
    </Flexbox>
    <SkeletonBar height={12} width={`${72 + (index % 2) * 8}%`} />
    <SkeletonBar height={12} width={`${48 + (index % 3) * 6}%`} />
    <Flexbox horizontal align={'center'} className={stylex.props(styles.footer).className} gap={12}>
      <SkeletonBar height={12} width={48} />
      <SkeletonBar height={12} width={36} />
      <SkeletonBar height={12} width={56} />
    </Flexbox>
  </Flexbox>
);

const TopicGridSkeleton = () => (
  <div aria-busy {...stylex.props(styles.grid)}>
    {Array.from({ length: 6 }).map((_, index) => (
      <TopicCardSkeleton index={index} key={index} />
    ))}
  </div>
);

const TopicsSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => {
  if (chrome === 'body') return <TopicGridSkeleton />;

  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      <NavHeader />
      <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
        <Flexbox
          gap={16}
          style={{
            marginInline: 'auto',
            maxWidth: 1440,
            width: '100%',
          }}
        >
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox horizontal gap={8}>
              <SkeletonBar height={32} radius={16} width={72} />
              <SkeletonBar height={32} radius={16} width={88} />
              <SkeletonBar height={32} radius={16} width={80} />
            </Flexbox>
            <Flexbox horizontal gap={8}>
              <SkeletonBar height={32} radius={8} width={36} />
              <SkeletonBar height={32} radius={8} width={36} />
            </Flexbox>
          </Flexbox>
          <TopicGridSkeleton />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default TopicsSkeleton;
