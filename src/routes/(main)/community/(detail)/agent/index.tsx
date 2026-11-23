'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import AgentDetail from '@/features/Marketplace/Agents/AgentDetail';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { assistantSelectors } from '@/store/discover/selectors';
import { type AssistantMarketSource } from '@/types/discover';

import NotFound from '../components/NotFound';
import StatusPage from './features/StatusPage';

interface AssistantDetailPageProps {
  mobile?: boolean;
}

const AssistantDetailPage = memo<AssistantDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const identifier = decodeURIComponent(params.slug ?? '');
  const { version, source } = useQuery() as { source?: AssistantMarketSource; version?: string };

  const useAssistantDetail = useDiscoverStore((s) => s.useFetchAssistantDetail);
  const { error, isLoading, mutate, queryKey } = useAssistantDetail({
    identifier,
    source,
    version,
  });
  const data = useDiscoverStore(assistantSelectors.assistantDetail(queryKey));

  if (data === undefined) {
    if (isLoading) return <RouteLoading />;
    if (error) return <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />;
    return <NotFound />;
  }
  const status = (data as any)?.status;
  if (status === 'unpublished' || status === 'archived' || status === 'deprecated') {
    return <StatusPage status={status} />;
  }

  return <AgentDetail detail={data} mobile={mobile} />;
});

export const MobileDiscoverAssistantDetailPage = (_props: { mobile?: boolean }) => {
  return <AssistantDetailPage mobile={true} />;
};

export default AssistantDetailPage;
