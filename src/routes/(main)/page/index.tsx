'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import PageExplorerPlaceholder from '@/features/PageExplorer/PageExplorerPlaceholder';

const PagesPage = memo(() => {
  return (
    <Suspense fallback={<Loading debugId="PagesPage" />}>
      <PageExplorerPlaceholder />
    </Suspense>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
