'use client';

import { createStaticStyles, cssVar, Flexbox } from '@lobehub/ui';

import { SkeletonBar } from '@/components/Skeleton';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Same card chrome as the loaded list column in `OAuthApps`.
  listCol: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  // Same padding and gap as `AppItem`'s row.
  row: css`
    padding-block: 12px;
    padding-inline: 12px;
  `,
}));

/** Centres a text-height skeleton bar inside the line box of the text it replaces. */
const Line = ({
  lineHeight,
  height,
  width,
}: {
  height: number;
  lineHeight: number;
  width: number;
}) => (
  <Flexbox height={lineHeight} justify={'center'}>
    <SkeletonBar height={height} width={width} />
  </Flexbox>
);

interface AppRowsSkeletonProps {
  rows?: number;
}

/**
 * Rows of the OAuth app list while it loads: 36px logo, the name and
 * description lines, then the type / last-used meta on the right, matching
 * `AppItem` so rows swap in place.
 */
export const AppRowsSkeleton = ({ rows = 2 }: AppRowsSkeletonProps) => (
  <>
    {Array.from({ length: rows }).map((_, index) => (
      <Flexbox horizontal align={'center'} className={styles.row} gap={12} key={index}>
        <SkeletonBar height={36} radius={cssVar.borderRadius} width={36} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Line height={14} lineHeight={22} width={index % 2 ? 112 : 144} />
          <Line height={12} lineHeight={20} width={index % 2 ? 200 : 240} />
        </Flexbox>
        <Line height={12} lineHeight={20} width={index % 2 ? 120 : 136} />
      </Flexbox>
    ))}
  </>
);

/** The OAuth app list card (same chrome as the loaded list) filled with row skeletons. */
const AppListSkeleton = ({ rows }: AppRowsSkeletonProps) => (
  <Flexbox aria-busy className={styles.listCol} gap={2} padding={4}>
    <AppRowsSkeleton rows={rows} />
  </Flexbox>
);

export default AppListSkeleton;
