'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type SkillQueryParams } from '@/types/discover';
import { DiscoverTab, SkillSorts } from '@/types/discover';

import SkillEmpty from '../../features/SkillEmpty';
import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const SkillPage = memo(() => {
  const { q, page, category, sort, order } = useQuery() as SkillQueryParams;
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const { data, isLoading, error, mutate } = useSkillList({
    category,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? SkillSorts.InstallCount,
  });

  const items = data?.items ?? [];

  return (
    <AsyncBoundary
      data={data}
      empty={<SkillEmpty />}
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
            tab={DiscoverTab.Skills}
            total={data.totalCount}
          />
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

export default SkillPage;
