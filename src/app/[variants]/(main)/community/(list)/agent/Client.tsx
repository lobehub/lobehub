'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { withSuspense } from '@/components/withSuspense';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type AssistantMarketSource, type AssistantQueryParams } from '@/types/discover';
import { DiscoverTab } from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const Client = memo<{ mobile?: boolean }>(() => {
  const { q, page, category, sort, order, ownerId, source } = useQuery() as AssistantQueryParams;
  const marketSource = (source as AssistantMarketSource | undefined) ?? 'new';
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const { data, isLoading } = useAssistantList({
    category,
    order,
    ownerId,
    page,
    pageSize: 21,
    q,
    sort,
    source: marketSource,
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

export default withSuspense(Client);
