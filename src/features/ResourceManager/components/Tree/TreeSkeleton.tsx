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

const TreeSkeletonItem = memo(() => {
  return (
    <Flexbox className={styles.container} horizontal>
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

const TreeSkeleton = memo(() => (
  <Flexbox gap={2}>
    {Array.from({ length: 8 }).map((_, i) => (
      <TreeSkeletonItem key={i} />
    ))}
  </Flexbox>
));

TreeSkeleton.displayName = 'TreeSkeleton';

export default TreeSkeleton;
