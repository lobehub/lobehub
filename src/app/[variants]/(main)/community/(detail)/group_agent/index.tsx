'use client';

import { Flexbox } from '@lobehub/ui';
import { useParams } from 'next/navigation';
import { memo } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { TocProvider } from '@/components/TocAnchor';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';

import Details from './features/Details';
import DetailProvider from './features/DetailProvider';
import Header from './features/Header';
import Loading from './loading';
import NotFound from './not-found';
import StatusPage from './features/StatusPage';

const GroupAgentDetailPage = memo(() => {
  const params = useParams<{ slug: string }>();
  const { version } = useQuery();

  // Decode the slug (identifier)
  const identifier = decodeURIComponent(params.slug);

  // Fetch group agent detail
  const useGroupAgentDetail = useDiscoverStore((s) => s.useGroupAgentDetail);
  const { data, isLoading } = useGroupAgentDetail({ identifier, version });

  if (isLoading) return <Loading />;

  if (!data) return <NotFound />;

  // Check status and show appropriate page
  const status = (data as any)?.group?.status || (data as any)?.status;
  if (status === 'unpublished' || status === 'archived' || status === 'deprecated') {
    return <StatusPage status={status} />;
  }

  return (
    <TocProvider>
      <DetailProvider config={data}>
        <Flexbox gap={16} width={'100%'}>
          {/* Header Section */}
          <Header />

          {/* Details Section */}
          <Details />
        </Flexbox>
      </DetailProvider>
    </TocProvider>
  );
});

export default GroupAgentDetailPage;
