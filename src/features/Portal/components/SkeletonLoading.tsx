import { Skeleton } from '@lobehub/ui';
import { memo } from 'react';

interface SkeletonLoadingProps {
  count?: number;
}

const SkeletonLoading = memo<SkeletonLoadingProps>(({ count = 3 }) => {
  return Array.from({ length: count }).map((key, index) => (
    <Skeleton.Button active block key={`${key}-${index}`} style={{ borderRadius: 8, height: 68 }} />
  ));
});

export default SkeletonLoading;
