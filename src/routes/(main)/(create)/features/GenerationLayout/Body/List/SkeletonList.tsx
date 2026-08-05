'use client';

import { Grid, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

const SkeletonList = memo<{ count?: number }>(({ count = 6 }) => {
  return (
    <Grid gap={4} maxItemWidth={64} padding={6} rows={6} width={'100%'}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton.Button
          active
          block
          key={index}
          style={{
            aspectRatio: 1,
            borderRadius: 4,
            height: 'auto',
            minWidth: 0,
          }}
        />
      ))}
    </Grid>
  );
});

SkeletonList.displayName = 'SkeletonList';

export default SkeletonList;
