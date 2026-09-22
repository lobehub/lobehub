'use client';

import { Grid } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

const SkeletonList = memo<{ count?: number }>(({ count = 6 }) => {
  return (
    <Grid gap={4} maxItemWidth={64} padding={6} rows={6} width={'100%'}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton height={'auto'} key={index} radius={4} style={{ aspectRatio: 1, minWidth: 0 }} />
      ))}
    </Grid>
  );
});

SkeletonList.displayName = 'SkeletonList';

export default SkeletonList;
