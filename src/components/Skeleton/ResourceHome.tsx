'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import SkeletonBar from './Bar';

/**
 * Shared by the route-level skeleton and the sections' own loading state, so
 * the placeholder never swaps shape between chunk load and data load.
 */
export const RESOURCE_HOME_SECTIONS = {
  files: { count: 4, itemHeight: 160, minItemWidth: 180 },
  libraries: { count: 4, itemHeight: 52, minItemWidth: 200 },
  pages: { count: 3, itemHeight: 64, minItemWidth: 240 },
  works: { count: 3, itemHeight: 220, minItemWidth: 260 },
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
    max-width: 1080px;
    margin-inline: auto;
    padding-block: 32px 64px;
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

const Section = (props: SectionSkeletonProps) => (
  <Flexbox gap={12}>
    <SkeletonBar height={18} width={112} />
    <ResourceSectionSkeleton {...props} />
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
      <Flexbox className={styles.content} gap={40}>
        <Section {...RESOURCE_HOME_SECTIONS.libraries} />
        <Section {...RESOURCE_HOME_SECTIONS.works} />
        <Section {...RESOURCE_HOME_SECTIONS.pages} />
        <Section {...RESOURCE_HOME_SECTIONS.files} />
      </Flexbox>
    </div>
  </Flexbox>
);

export default ResourceHomeSkeleton;
