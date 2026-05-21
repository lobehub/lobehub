'use client';

import type { SharedDocumentData } from '@lobechat/types';
import { useUnmount } from 'ahooks';
import { memo, Suspense } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { createStoreUpdater } from 'zustand-utils';

import Loading from '@/components/Loading/BrandTextLoading';
import PageExplorer from '@/features/PageExplorer';
import ReadOnlyPageViewer from '@/features/PageShare/ReadOnlyPageViewer';
import { usePageStore } from '@/store/page';
import { getIdFromIdentifier } from '@/utils/identifier';

type PageOutletContext = { error?: unknown; probe?: SharedDocumentData } | undefined;
const PagesPage = memo(() => {
  const storeUpdater = createStoreUpdater(usePageStore);
  const params = useParams<{ id: string }>();
  const context = useOutletContext<PageOutletContext>();
  const probe = context?.probe;

  const pageId = getIdFromIdentifier(params.id ?? '', 'docs');

  useUnmount(() => {
    usePageStore.setState({ selectedPageId: undefined });
  });

  if (probe && !probe.isOwner) {
    return <ReadOnlyPageViewer data={probe} />;
  }

  storeUpdater('selectedPageId', pageId);

  return (
    <Suspense fallback={<Loading debugId="PagesPage" />}>
      <PageExplorer pageId={pageId} />
    </Suspense>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
