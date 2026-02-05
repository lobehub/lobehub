'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    gap: 6px;
    align-items: center;

    height: 32px;
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};
  `,
}));

interface TreeSkeletonItemProps {
  opacity?: number;
}

const TreeSkeletonItem = memo<TreeSkeletonItemProps>(({ opacity = 1 }) => {
  return (
    <Flexbox horizontal className={styles.container} style={{ opacity }}>
      <Skeleton.Button
        active
        size={'small'}
        style={{
          flex: 'none',
          height: 16,
          width: 16,
        }}
      />
      <Skeleton.Button
        active
        size={'small'}
        style={{
          height: 16,
          width: `${Math.floor(Math.random() * 30 + 40)}%`,
        }}
      />
    </Flexbox>
  );
});

TreeSkeletonItem.displayName = 'TreeSkeletonItem';

const TreeSkeleton = memo(() => {
  const count = 6;
  // Calculate opacity gradient from 100% to 20%
  const getOpacity = (index: number) => 1 - (index / (count - 1)) * 0.8;

  return (
    <Flexbox gap={2}>
      {Array.from({ length: count }).map((_, i) => (
        <TreeSkeletonItem key={i} opacity={getOpacity(i)} />
      ))}
    </Flexbox>
  );
});

TreeSkeleton.displayName = 'TreeSkeleton';

export default TreeSkeleton;
