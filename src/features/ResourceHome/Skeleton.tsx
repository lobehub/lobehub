'use client';

import { Flexbox } from '@lobehub/ui';
import { useLocation, useSearchParams } from 'react-router';

import SkeletonBar from '@/components/Skeleton/Bar';
import ListViewSkeleton from '@/features/ResourceManager/components/Explorer/ListView/Skeleton';
import MasonryViewSkeleton from '@/features/ResourceManager/components/Explorer/MasonryView/Skeleton';
import { useMasonryColumnCount } from '@/features/ResourceManager/components/Explorer/useMasonryColumnCount';
import WorkGallerySkeleton from '@/features/WorkGallery/Skeleton';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import { resolveResourceSkeletonView } from './skeletonView';

const ResourceCategorySkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const columnCount = useMasonryColumnCount();
  const view = resolveResourceSkeletonView(pathname, searchParams.get('view'));

  if (view === 'works') return <WorkGallerySkeleton />;

  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      {chrome !== 'body' && (
        <Flexbox
          horizontal
          align={'center'}
          flex={'none'}
          height={44}
          justify={'space-between'}
          paddingInline={16}
        >
          <SkeletonBar height={20} width={144} />
          <SkeletonBar height={28} width={72} />
        </Flexbox>
      )}
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
        {view === 'masonry' ? (
          <MasonryViewSkeleton columnCount={columnCount} />
        ) : (
          <ListViewSkeleton showUploader={!pathname.startsWith('/resource')} />
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default ResourceCategorySkeleton;
