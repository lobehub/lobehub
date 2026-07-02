'use client';

import { useUnmount } from 'ahooks';
import { memo, Suspense } from 'react';
import { useParams } from 'react-router';
import { createStoreUpdater } from 'zustand-utils';

import Loading from '@/components/Loading/BrandTextLoading';
import PageExplorer from '@/features/PageExplorer';
import { usePageStore } from '@/store/page';
import { getIdFromIdentifier } from '@/utils/identifier';

const PagesPage = memo(() => {
  const storeUpdater = createStoreUpdater(usePageStore);
  const params = useParams<{ id: string }>();

  const pageId = getIdFromIdentifier(params.id ?? '', 'docs');

  useUnmount(() => {
    usePageStore.setState({ selectedPageId: undefined });
  });

  storeUpdater('selectedPageId', pageId);

  return (
    <Suspense fallback={<Loading debugId="PagesPage" />}>
      <PageExplorer pageId={pageId} />
    </Suspense>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
