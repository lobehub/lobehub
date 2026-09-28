'use client';

import { Suspense } from 'react';

import { delayed } from '@/components/Skeleton/Delayed';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import PageExplorerPlaceholder from '@/features/PageExplorer/PageExplorerPlaceholder';

const PagesPage = () => {
  return (
    <Suspense fallback={delayed(<SurfaceSkeleton variant={'editor'} />)}>
      <PageExplorerPlaceholder />
    </Suspense>
  );
};

export default PagesPage;
