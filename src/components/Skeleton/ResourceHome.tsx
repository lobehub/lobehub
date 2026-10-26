'use client';

import { createStaticStyles, cssVar, Flexbox } from '@lobehub/ui';

import SkeletonBar from './Bar';

/**
 * Shared by the route-level skeleton and the sections' own loading state, so
 * the placeholder never swaps shape between chunk load and data load.
 */
export const RESOURCE_HOME_SECTIONS = {
  libraries: { count: 4, itemHeight: 52, minItemWidth: 200 },
  quickActions: { count: 3, itemHeight: 66, minItemWidth: 220 },
} as const;

interface SectionSkeletonProps {
  count: number;
  itemHeight: number;
  minItemWidth: number;
}

export const ResourceSectionSkeleton = ({
  count,
  itemHeight,
  minItemWidth,
}: SectionSkeletonProps) => (
  <div
    style={{
      display: 'grid',
      gap: 12,
      gridTemplateColumns: `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))`,
    }}
  >
    {Array.from({ length: count }).map((_, index) => (
      <SkeletonBar height={itemHeight} key={index} radius={cssVar.borderRadiusLG} />
    ))}
  </div>
);

const styles = createStaticStyles(({ css }) => ({
  content: css`
    width: 100%;
    max-width: 1200px;
    margin-inline: auto;
    padding-block: 24px 64px;
    padding-inline: 32px;
  `,
  header: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  scroll: css`
    overflow: hidden;
    flex: 1;
  `,
}));

/** Mirrors the Docs home: quick actions, then the tabbed list. */
const ListSkeleton = () => (
  <Flexbox gap={12}>
    <Flexbox horizontal gap={24}>
      <SkeletonBar height={20} width={72} />
      <SkeletonBar height={20} width={72} />
      <SkeletonBar height={20} width={72} />
    </Flexbox>
    <Flexbox gap={8}>
      {Array.from({ length: 8 }).map((_, index) => (
        <SkeletonBar height={36} key={index} />
      ))}
    </Flexbox>
  </Flexbox>
);

const ResourceHomeSkeleton = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <Flexbox
      horizontal
      align={'center'}
      className={styles.header}
      flex={'none'}
      height={44}
      justify={'space-between'}
      paddingInline={16}
    >
      <SkeletonBar height={20} width={96} />
      <SkeletonBar height={28} width={88} />
    </Flexbox>
    <div className={styles.scroll}>
      <Flexbox className={styles.content} gap={28}>
        <ResourceSectionSkeleton {...RESOURCE_HOME_SECTIONS.quickActions} />
        <ListSkeleton />
      </Flexbox>
    </div>
  </Flexbox>
);

export default ResourceHomeSkeleton;
