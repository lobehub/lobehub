'use client';

import { Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import PageExplorerPlaceholder from '@/features/PageExplorer/PageExplorerPlaceholder';

const PagesPage = () => {
  return (
    <Suspense fallback={<SurfaceSkeleton variant={'editor'} />}>
      <PageExplorerPlaceholder />
    </Suspense>
  );
};

export default PagesPage;
