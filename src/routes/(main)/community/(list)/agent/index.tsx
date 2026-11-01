'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { buildAssistantListQuery } from '@/features/CommunityAgentList/assistantListQuery';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { assistantSelectors } from '@/store/discover/selectors';
import { type AssistantQueryParams } from '@/types/discover';
import { DiscoverTab } from '@/types/discover';

import AssistantEmpty from '../../features/AssistantEmpty';
import Pagination from '../features/Pagination';
import List from './features/List';

const AssistantPage = memo(() => {
  const query = useQuery() as AssistantQueryParams;
  const useAssistantList = useDiscoverStore((s) => s.useFetchAssistantList);
  const { error, isLoading, mutate, queryKey } = useAssistantList(buildAssistantListQuery(query));
  // The replica view of this query; the sync hook only reports the fetch flags.
  const data = useDiscoverStore(assistantSelectors.assistantList(queryKey));

  const items = data?.items ?? [];

  return (
    <AsyncBoundary
      data={data}
      empty={<AssistantEmpty />}
      error={error}
      errorVariant={'page'}
      isEmpty={items.length === 0}
      isLoading={isLoading}
      loading={<RouteLoading />}
      onRetry={() => mutate()}
    >
      {data && (
        <Flexbox gap={32} width={'100%'}>
          <List data={items} />
          <Pagination
            currentPage={data.currentPage}
            pageSize={data.pageSize}
            tab={DiscoverTab.Assistants}
            total={data.totalCount}
          />
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

export default AssistantPage;
