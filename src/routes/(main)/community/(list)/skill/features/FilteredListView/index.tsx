'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { DiscoverTab, type SkillQueryParams, SkillSorts } from '@/types/discover';

import SkillEmpty from '../../../../features/SkillEmpty';
import Pagination from '../../../features/Pagination';
import Loading from '../../loading';
import FeaturedCard from '../DiscoverView/FeaturedSection/FeaturedCard';

const FilteredListView = memo(() => {
  const { q, page, category, sort, order } = useQuery() as SkillQueryParams;
  const useFetchSkillList = useDiscoverStore((s) => s.useFetchSkillList);

  const { data, isLoading } = useFetchSkillList({
    category,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? SkillSorts.InstallCount,
  });

  if (isLoading || !data) return <Loading />;

  const { items, currentPage, pageSize, totalCount } = data;

  if (items.length === 0) return <SkillEmpty />;

  return (
    <Flexbox gap={32} width={'100%'}>
      <Grid rows={3} width={'100%'}>
        {items.map((item) => (
          <FeaturedCard key={item.identifier} {...item} />
        ))}
      </Grid>
      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        tab={DiscoverTab.Skills}
        total={totalCount}
      />
    </Flexbox>
  );
});

export default FilteredListView;
