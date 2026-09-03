'use client';

import { Flexbox } from '@lobehub/ui';
import { useLocation, useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { SurfaceHeaderSkeleton } from '@/components/Skeleton/Surface';
import ListViewSkeleton from '@/features/ResourceManager/components/Explorer/ListView/Skeleton';
import MasonryViewSkeleton from '@/features/ResourceManager/components/Explorer/MasonryView/Skeleton';
import { useMasonryColumnCount } from '@/features/ResourceManager/components/Explorer/useMasonryColumnCount';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import WorkGallerySkeleton from '@/features/WorkGallery/Skeleton';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import { resolveResourceSkeletonView } from './skeletonView';

const ResourceCategorySkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const activeWorkspaceId = useActiveWorkspaceId();
  const columnCount = useMasonryColumnCount();
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const view = resolveResourceSkeletonView(pathname, searchParams.get('view'));

  if (view === 'works') return <WorkGallerySkeleton />;

  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      {chrome !== 'body' && <SurfaceHeaderSkeleton />}
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
        {view === 'masonry' ? (
          <MasonryViewSkeleton columnCount={columnCount} />
        ) : (
          <ListViewSkeleton showUploader={!!activeWorkspaceId && listVisibility !== 'private'} />
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default ResourceCategorySkeleton;
