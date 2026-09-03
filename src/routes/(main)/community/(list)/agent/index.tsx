'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { buildAssistantListQuery } from '@/features/CommunityAgentList/assistantListQuery';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type AssistantQueryParams } from '@/types/discover';
import { DiscoverTab } from '@/types/discover';

import AssistantEmpty from '../../features/AssistantEmpty';
import Pagination from '../features/Pagination';
import List from './features/List';

const AssistantPage = memo(() => {
  const query = useQuery() as AssistantQueryParams;
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const { data, error, mutate } = useAssistantList(buildAssistantListQuery(query));

  const items = data?.items ?? [];

  return (
    <AsyncBoundary
      data={data}
      empty={<AssistantEmpty />}
      error={error}
      errorVariant={'page'}
      isEmpty={items.length === 0}
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
