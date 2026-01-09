'use client';

import { Suspense, memo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import PageExplorerPlaceholder from '@/features/PageExplorer/PageExplorerPlaceholder';
import { pageSelectors, usePageStore } from '@/store/page';

import PageTitle from './PageTitle';

/**
 * Pages route - dedicated page for managing documents/pages
 * This is extracted from the /resource route to have its own dedicated space
 */
const PagesPage = memo(() => {
  const documents = usePageStore(pageSelectors.getFilteredDocuments);
  const hasPages = documents.length > 0;

  return (
    <>
      <PageTitle />
      <Suspense fallback={<Loading debugId="PagesPage" />}>
        <PageExplorerPlaceholder hasPages={hasPages} />
      </Suspense>
    </>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
