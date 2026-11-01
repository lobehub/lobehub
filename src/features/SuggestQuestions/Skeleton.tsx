'use client';

import { Flexbox, Skeleton as LobeSkeleton } from '@lobehub/ui';
import { memo } from 'react';

interface SkeletonProps {
  count?: number;
}

const Skeleton = memo<SkeletonProps>(({ count = 3 }) => {
  return (
    <Flexbox gap={8}>
      {Array.from({ length: count }).map((_, index) => (
        <LobeSkeleton height={68} key={index} />
      ))}
    </Flexbox>
  );
});

export default Skeleton;
