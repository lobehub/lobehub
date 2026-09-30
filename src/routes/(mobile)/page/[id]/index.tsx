'use client';

import { useUnmount } from 'ahooks';
import { memo, Suspense } from 'react';
import { useParams } from 'react-router';
import { createStoreUpdater } from 'zustand-utils';

import { delayed } from '@/components/Skeleton/Delayed';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import PageExplorer from '@/features/PageExplorer';
import MobilePageHeader from '@/features/Pages/MobilePageHeader';
import { usePageStore } from '@/store/page';
import { getIdFromIdentifier } from '@/utils/identifier';

const MobilePageDetail = memo(() => {
  const storeUpdater = createStoreUpdater(usePageStore);
  const params = useParams<{ id: string }>();

  const pageId = getIdFromIdentifier(params.id ?? '', 'docs');

  // Mobile mounts no page list, so load this page into the store directly —
  // PageEditor reads title, emoji and workspace lock state from it.
  const useFetchPageDetail = usePageStore((s) => s.useFetchPageDetail);
  useFetchPageDetail(pageId);

  useUnmount(() => {
    usePageStore.setState({ selectedPageId: undefined });
  });

  storeUpdater('selectedPageId', pageId);

  return (
    <Suspense fallback={delayed(<SurfaceSkeleton variant={'editor'} />)}>
      <PageExplorer header={<MobilePageHeader />} pageId={pageId} rightPanel={false} />
    </Suspense>
  );
});

MobilePageDetail.displayName = 'MobilePageDetail';

export default MobilePageDetail;
