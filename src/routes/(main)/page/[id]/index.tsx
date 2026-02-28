'use client';

import { useUnmount } from 'ahooks';
import { memo,Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import Loading from '@/components/Loading/BrandTextLoading';
import PageExplorer from '@/features/PageExplorer';
import { usePageStore } from '@/store/page';
import { getIdFromIdentifier } from '@/utils/identifier';

import PageTitle from '../PageTitle';

/**
 * Pages route - dedicated page for managing documents/pages
 * This is extracted from the /resource route to have its own dedicated space
 */
const PagesPage = memo(() => {
  const storeUpdater = createStoreUpdater(usePageStore);
  const params = useParams<{ id: string }>();

  const pageId = getIdFromIdentifier(params.id ?? '', 'docs');
  storeUpdater('selectedPageId', pageId);

  // Clear activeAgentId when unmounting (leaving chat page)
  useUnmount(() => {
    usePageStore.setState({ selectedPageId: undefined });
  });

  return (
    <>
      <PageTitle />
      <Suspense fallback={<Loading debugId="PagesPage" />}>
        <PageExplorer pageId={pageId} />
      </Suspense>
    </>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
