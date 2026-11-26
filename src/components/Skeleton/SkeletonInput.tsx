'use client';

import { Skeleton } from '@lobehub/ui';

import { useInterfaceDensity } from '@/styles/density';

export const SkeletonInput = () => {
  const compact = useInterfaceDensity() === 'compact';

  return <Skeleton height={compact ? 28 : 36} />;
};
