'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type AssistantQueryParams } from '@/types/discover';
import { AssistantSorts, DiscoverTab } from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const AssistantPage = memo(() => {
  const { q, page, category, sort, order, source } = useQuery() as AssistantQueryParams;
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const { data, isLoading } = useAssistantList({
    category,
    includeAgentGroup: true,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? AssistantSorts.Recommended,
    source,
  });

  if (isLoading || !data) return <Loading />;

  const { items, currentPage, pageSize, totalCount } = data;

  return (
    <Flexbox gap={32} width={'100%'}>
      <List data={items} />
      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        tab={DiscoverTab.Assistants}
        total={totalCount}
      />
    </Flexbox>
  );
});

export default AssistantPage;
