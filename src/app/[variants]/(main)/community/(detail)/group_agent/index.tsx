'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { TocProvider } from '../features/Toc/useToc';
import Details from './features/Details';
import { DetailProvider } from './features/DetailProvider';
import Header from './features/Header';
import StatusPage from './features/StatusPage';
import Loading from './loading';

interface GroupAgentDetailPageProps {
  mobile?: boolean;
}

const GroupAgentDetailPage = memo<GroupAgentDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = decodeURIComponent(params.slug ?? '');
  const { version } = useQuery() as { version?: string };

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
      <DetailProvider config={data as any}>
        <Flexbox gap={16} width={'100%'}>
          {/* Header Section */}
          <Header mobile={mobile} />

          {/* Details Section */}
          <Details mobile={mobile} />
        </Flexbox>
      </DetailProvider>
    </TocProvider>
  );
});

export default GroupAgentDetailPage;
