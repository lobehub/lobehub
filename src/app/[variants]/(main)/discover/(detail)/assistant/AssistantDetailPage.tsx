'use client';

import { memo } from 'react';
import { useParams } from 'react-router-dom';
import { Flexbox } from 'react-layout-kit';

import { withSuspense } from '@/components/withSuspense';
import { useDiscoverStore } from '@/store/discover';
import { DiscoverTab } from '@/types/discover';

import Breadcrumb from '../features/Breadcrumb';
import { TocProvider } from '../features/Toc/useToc';
import NotFound from '../components/NotFound';
import { DetailProvider } from './[...slugs]/features/DetailProvider';
import Details from './[...slugs]/features/Details';
import Header from './[...slugs]/features/Header';
import Loading from './[...slugs]/loading';

interface AssistantDetailPageProps {
  mobile?: boolean;
}

const AssistantDetailPage = memo<AssistantDetailPageProps>(({ mobile }) => {
  const params = useParams();
  const slugs = params['*']?.split('/') || [];
  const identifier = decodeURIComponent(slugs.join('/'));

  const useAssistantDetail = useDiscoverStore((s) => s.useAssistantDetail);
  const { data, isLoading } = useAssistantDetail({ identifier });

  if (isLoading) return <Loading />;
  if (!data) return <NotFound />;

  return (
    <TocProvider>
      <DetailProvider config={data}>
        {!mobile && <Breadcrumb identifier={identifier} tab={DiscoverTab.Assistants} />}
        <Flexbox gap={16}>
          <Header mobile={mobile} />
          <Details mobile={mobile} />
        </Flexbox>
      </DetailProvider>
    </TocProvider>
  );
});

export default withSuspense(AssistantDetailPage);
