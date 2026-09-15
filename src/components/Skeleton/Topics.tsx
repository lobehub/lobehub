'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, responsive } from 'antd-style';

import NavHeader from '@/features/NavHeader';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    min-height: 140px;
    padding: 14px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  footer: css`
    margin-block-start: auto;
    padding-block-start: 10px;
    border-block-start: 1px solid ${cssVar.colorSplit};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
    gap: 12px;

    width: 100%;
    min-width: 0;

    ${responsive.md} {
      grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
    }
  `,
}));

const TopicCardSkeleton = ({ index }: { index: number }) => (
  <Flexbox className={styles.card} gap={10}>
    <Flexbox horizontal align={'center'} gap={8}>
      <SkeletonBar height={8} radius={'50%'} width={8} />
      <SkeletonBar height={16} width={`${46 + (index % 3) * 10}%`} />
    </Flexbox>
    <SkeletonBar height={12} width={`${72 + (index % 2) * 8}%`} />
    <SkeletonBar height={12} width={`${48 + (index % 3) * 6}%`} />
    <Flexbox horizontal align={'center'} className={styles.footer} gap={12}>
      <SkeletonBar height={12} width={48} />
      <SkeletonBar height={12} width={36} />
      <SkeletonBar height={12} width={56} />
    </Flexbox>
  </Flexbox>
);

const TopicGridSkeleton = () => (
  <div aria-busy className={styles.grid}>
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
