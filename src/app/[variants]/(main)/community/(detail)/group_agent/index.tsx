'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { TocProvider } from '../features/Toc/useToc';
import { DetailProvider } from './features/DetailProvider';
import Details from './features/Details';
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

  // Transform API data to match DiscoverGroupAgentDetail type
  const apiConfig = (data as any)?.currentVersion?.config || {};

  const transformedData = {
    // Top level fields
    author: (data as any)?.author,
    // From currentVersion
    avatar: (data as any)?.currentVersion?.avatar,
    backgroundColor: (data as any)?.currentVersion?.backgroundColor,
    category: (data as any)?.currentVersion?.category,
    commentCount: (data as any)?.group?.commentCount,

    // From currentVersion.config - rename systemPrompt to systemRole for consistency
    config: {
      ...apiConfig,
      allowDM: apiConfig.allowDM,
      // Rename systemPrompt -> systemRole
      openingMessage: apiConfig.openingMessage,
      openingQuestions: apiConfig.openingQuestions,
      revealDM: apiConfig.revealDM,
      summary: apiConfig.summary,
      systemRole: apiConfig.systemPrompt,
    },

    createdAt: (data as any)?.group?.createdAt,
    // Version info
    currentVersion: (data as any)?.currentVersion?.version,
    currentVersionNumber: (data as any)?.currentVersion?.versionNumber,
    description: (data as any)?.currentVersion?.description,
    favoriteCount: (data as any)?.group?.favoriteCount,
    homepage: (data as any)?.group?.homepage,
    // From group
    identifier: (data as any)?.group?.identifier,
    installCount: (data as any)?.group?.installCount,
    likeCount: (data as any)?.group?.likeCount,
    locale: (data as any)?.locale,
    memberAgents: (data as any)?.memberAgents || [],
    status: (data as any)?.group?.status,
    summary: (data as any)?.summary,
    tags: (data as any)?.currentVersion?.tags,
    title: (data as any)?.currentVersion?.name || (data as any)?.group?.name,
    updatedAt: (data as any)?.group?.updatedAt,
    userName: (data as any)?.author?.userName,
    versions: (data as any)?.versions || [],
    visibility: (data as any)?.group?.visibility,
  };

  return (
    <TocProvider>
      <DetailProvider config={transformedData}>
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
