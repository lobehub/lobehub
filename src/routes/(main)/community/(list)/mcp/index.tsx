'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type McpQueryParams } from '@/types/discover';
import { DiscoverTab, McpSorts } from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const McpPage = memo(() => {
  const { q, page, category, sort, order } = useQuery() as McpQueryParams;
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);
  const { data, isLoading } = useMcpList({
    category,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? McpSorts.Recommended,
  });

  if (isLoading || !data) return <Loading />;

  const { items, currentPage, pageSize, totalCount } = data;

  return (
    <Flexbox gap={32} width={'100%'}>
      <List data={items} />
      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        tab={DiscoverTab.Mcp}
        total={totalCount}
      />
    </Flexbox>
  );
});

export default McpPage;
