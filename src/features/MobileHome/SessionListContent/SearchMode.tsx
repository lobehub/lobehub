import { memo } from 'react';

import { useHomeStore } from '@/store/home';

import { useAgentSearch } from '../Layout/AgentSearchContext';
import SkeletonList from '../SkeletonList';
import { AgentSearchList } from './AgentSearchList';

const SearchMode = memo(() => {
  const { keywords: sessionSearchKeywords } = useAgentSearch();
  const useSearchAgents = useHomeStore((s) => s.useSearchAgents);

  const { data, isLoading } = useSearchAgents(sessionSearchKeywords?.trim() || undefined);

  return isLoading ? <SkeletonList /> : <AgentSearchList dataSource={data} />;
});

SearchMode.displayName = 'SessionSearchMode';

export default SearchMode;
