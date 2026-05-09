import { memo, useMemo } from 'react';

import { useHomeStore } from '@/store/home';

import SkeletonList from '../SkeletonList';
import AgentList from './List';

const SearchMode = memo(() => {
  const [agentSearchKeywords, useSearchAgents] = useHomeStore((s) => [
    s.agentSearchKeywords,
    s.useSearchAgents,
  ]);

  const { data, isLoading } = useSearchAgents(agentSearchKeywords);

  const filteredData = useMemo(() => {
    if (!data) return data;

    return data.filter((item) => item.type === 'agent');
  }, [data]);

  return isLoading ? (
    <SkeletonList />
  ) : (
    <AgentList dataSource={filteredData} showAddButton={false} />
  );
});

SearchMode.displayName = 'AgentSearchMode';

export default SearchMode;
