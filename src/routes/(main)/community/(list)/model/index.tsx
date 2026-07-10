'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type ModelQueryParams } from '@/types/discover';
import { DiscoverTab } from '@/types/discover';

import ModelEmpty from '../../features/ModelEmpty';
import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const ModelPage = memo<{ mobile?: boolean }>(() => {
  const { q, page, category, sort, order } = useQuery() as ModelQueryParams;
  const useModelList = useDiscoverStore((s) => s.useModelList);
  const { data, isLoading, error, mutate } = useModelList({
    category,
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
      empty={<ModelEmpty />}
      error={error}
      errorVariant={'page'}
      isEmpty={items.length === 0}
      isLoading={isLoading}
      loading={<Loading />}
      onRetry={() => mutate()}
    >
      {data && (
        <Flexbox gap={32} width={'100%'}>
          <List data={items} />
          <Pagination
            currentPage={data.currentPage}
            pageSize={data.pageSize}
            tab={DiscoverTab.Models}
            total={data.totalCount}
          />
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

export default ModelPage;
