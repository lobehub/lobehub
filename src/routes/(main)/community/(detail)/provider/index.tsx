'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { DetailProvider } from './features/DetailProvider';
import Details from './features/Details';
import Header from './features/Header';

interface ProviderDetailPageProps {
  mobile?: boolean;
}

const ProviderDetailPage = memo<ProviderDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = decodeURIComponent(params.slug ?? '');

  const useProviderDetail = useDiscoverStore((s) => s.useProviderDetail);
  const { data } = useProviderDetail({ identifier, withReadme: true });
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

export const MobileProviderPage = (_props: { mobile?: boolean }) => {
  return <ProviderDetailPage mobile={true} />;
};

export default ProviderDetailPage;
