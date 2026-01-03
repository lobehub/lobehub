'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { DetailProvider } from './features/DetailProvider';
import Details from './features/Details';
import Header from './features/Header';
import Loading from './loading';

interface ModelDetailPageProps {
  mobile?: boolean;
}

const ModelDetailPage = memo<ModelDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = decodeURIComponent(params.slug ?? '');

  const useModelDetail = useDiscoverStore((s) => s.useModelDetail);
  const { data, isLoading } = useModelDetail({ identifier });

  if (isLoading) return <Loading />;
  if (!data) return <NotFound />;

  return (
    <DetailProvider config={data}>
      <Flexbox gap={16}>
        <Header mobile={mobile} />
        <Details mobile={mobile} />
      </Flexbox>
    </DetailProvider>
  );
});

export const MobileModelPage = memo<{ mobile?: boolean }>(() => {
  return <ModelDetailPage mobile={true} />;
});

export default ModelDetailPage;
