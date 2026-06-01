'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { useQuery } from '@/hooks/useQuery';
import { type SkillQueryParams } from '@/types/discover';

import DiscoverView from './features/DiscoverView';
import FilteredListView from './features/FilteredListView';
import TabNavigation from './features/TabNavigation';

const SkillPage = memo(() => {
  const { category, sort, q } = useQuery() as SkillQueryParams;

  const isDiscoverView = useMemo(() => {
    return !category && !sort && !q;
  }, [category, sort, q]);

  return (
    <Flexbox gap={24} width={'100%'}>
      <TabNavigation />
      {isDiscoverView ? <DiscoverView /> : <FilteredListView />}
    </Flexbox>
  );
});

export default SkillPage;
