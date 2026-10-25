'use client';

import { memo } from 'react';

import { useAgentSearch } from '../Layout/AgentSearchContext';
import DefaultMode from './DefaultMode';
import SearchMode from './SearchMode';

const SessionListContent = memo(() => {
  const { keywords } = useAgentSearch();
  const isSearching = !!keywords.trim();

  return isSearching ? <SearchMode /> : <DefaultMode />;
});

SessionListContent.displayName = 'SessionListContent';

export default SessionListContent;
