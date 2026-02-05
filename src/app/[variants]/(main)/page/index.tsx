'use client';

import { memo,Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import PageExplorerPlaceholder from '@/features/PageExplorer/PageExplorerPlaceholder';

import PageTitle from './PageTitle';

/**
 * Pages route - dedicated page for managing documents/pages
 * This is extracted from the /resource route to have its own dedicated space
 */
const PagesPage = memo(() => {
  return (
    <>
      <PageTitle />
      <Suspense fallback={<Loading debugId="PagesPage" />}>
        <PageExplorerPlaceholder />
      </Suspense>
    </>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
