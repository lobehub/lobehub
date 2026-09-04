'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { DetailProvider } from '@/features/MCPPluginDetail/DetailProvider';
import Header from '@/features/MCPPluginDetail/Header';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useQuery } from '@/hooks/useQuery';
import { useParams } from '@/libs/router/navigation';
import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { TocProvider } from '../features/Toc/useToc';
import Details from './features/Details';

interface McpDetailPageProps {
  mobile?: boolean;
}

const McpDetailPage = memo<McpDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>('slug');
  const identifier = params.slug ?? '';

  const { version } = useQuery() as { version?: string };
  const useMcpDetail = useDiscoverStore((s) => s.useFetchMcpDetail);
  const { data } = useMcpDetail({ identifier, version });

  useFetchInstalledPlugins();
  if (!data) return <NotFound />;

  return (
    <TocProvider>
      <DetailProvider config={data}>
        <Flexbox data-testid="mcp-detail-content" gap={16}>
          <Header mobile={mobile} />
          <Details mobile={mobile} />
        </Flexbox>
      </DetailProvider>
    </TocProvider>
  );
});

export const MobileMcpPage = (_props: { mobile?: boolean }) => {
  return <McpDetailPage mobile={true} />;
};

export default McpDetailPage;
