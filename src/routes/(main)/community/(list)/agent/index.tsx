'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type AssistantQueryParams } from '@/types/discover';
import { AssistantSorts, DiscoverTab } from '@/types/discover';

import AssistantEmpty from '../../features/AssistantEmpty';
import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const AssistantPage = memo(() => {
  const { q, page, category, sort, order, source } = useQuery() as AssistantQueryParams;
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const { data, isLoading, error, mutate } = useAssistantList({
    category,
    includeAgentGroup: true,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? AssistantSorts.Recommended,
    source,
  });

  const items = data?.items ?? [];

  return (
    <AsyncBoundary
      data={data}
      empty={<AssistantEmpty />}
      error={error}
      isEmpty={items.length === 0}
      isLoading={isLoading || !data}
      loading={<Loading />}
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
