'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { useDiscoverStore } from '@/store/discover';
import { modelSelectors } from '@/store/discover/selectors';

import NotFound from '../components/NotFound';
import { DetailProvider } from './features/DetailProvider';
import Details from './features/Details';
import Header from './features/Header';

interface ModelDetailPageProps {
  mobile?: boolean;
}

const ModelDetailPage = memo<ModelDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = decodeURIComponent(params.slug ?? '');

  const useModelDetail = useDiscoverStore((s) => s.useFetchModelDetail);
  const { error, isLoading, mutate, queryKey } = useModelDetail({ identifier });
  const data = useDiscoverStore(modelSelectors.modelDetail(queryKey));
  if (data === undefined) {
    if (isLoading) return <RouteLoading />;
    if (error) return <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />;
    return <NotFound />;
  }

  return (
    <DetailProvider config={data}>
      <Flexbox gap={16}>
        <Header mobile={mobile} />
        <Details mobile={mobile} />
      </Flexbox>
    </DetailProvider>
  );
});

export const MobileModelPage = (_props: { mobile?: boolean }) => {
  return <ModelDetailPage mobile={true} />;
};

export default ModelDetailPage;
