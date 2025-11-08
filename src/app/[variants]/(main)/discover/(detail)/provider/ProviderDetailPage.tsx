'use client';

import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { useParams } from 'react-router-dom';

import { withSuspense } from '@/components/withSuspense';
import { useDiscoverStore } from '@/store/discover';
import { DiscoverTab } from '@/types/discover';

import NotFound from '../components/NotFound';
import Breadcrumb from '../features/Breadcrumb';
import { DetailProvider } from './[...slugs]/features/DetailProvider';
import Details from './[...slugs]/features/Details';
import Header from './[...slugs]/features/Header';
import Loading from './[...slugs]/loading';

interface ProviderDetailPageProps {
  mobile?: boolean;
}

const ProviderDetailPage = memo<ProviderDetailPageProps>(({ mobile }) => {
  const params = useParams();
  const slugs = params['*']?.split('/') || [];
  const identifier = decodeURIComponent(slugs.join('/'));

  const useProviderDetail = useDiscoverStore((s) => s.useProviderDetail);
  const { data, isLoading } = useProviderDetail({ identifier, withReadme: true });

  if (isLoading) return <Loading />;
  if (!data) return <NotFound />;

  return (
    <DetailProvider config={data}>
      {!mobile && <Breadcrumb identifier={identifier} tab={DiscoverTab.Providers} />}
      <Flexbox gap={16}>
        <Header mobile={mobile} />
        <Details mobile={mobile} />
      </Flexbox>
    </DetailProvider>
  );
});

export default withSuspense(ProviderDetailPage);
