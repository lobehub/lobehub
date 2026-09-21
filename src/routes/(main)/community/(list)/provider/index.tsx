'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type ProviderQueryParams } from '@/types/discover';
import { DiscoverTab } from '@/types/discover';

import ProviderEmpty from '../../features/ProviderEmpty';
import Pagination from '../features/Pagination';
import List from './features/List';

const ProviderPage = memo(() => {
  const { q, page, sort, order } = useQuery() as ProviderQueryParams;
  const useProviderList = useDiscoverStore((s) => s.useProviderList);
  const { data, error, isLoading, mutate } = useProviderList({
    order,
    page,
    pageSize: 21,
    q,
    sort,
  });

  const items = data?.items ?? [];

  return (
    <AsyncBoundary
      data={data}
      empty={<ProviderEmpty />}
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
            tab={DiscoverTab.Providers}
            total={data.totalCount}
          />
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

export default ProviderPage;
