'use client';

import { memo, Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import PageExplorerPlaceholder from '@/features/PageExplorer/PageExplorerPlaceholder';

const PagesPage = memo(() => {
  return (
    <Suspense fallback={<SurfaceSkeleton variant={'editor'} />}>
      <PageExplorerPlaceholder />
    </Suspense>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
