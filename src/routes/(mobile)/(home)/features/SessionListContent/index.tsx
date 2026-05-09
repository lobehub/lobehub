'use client';

import { memo } from 'react';

import { useHomeStore } from '@/store/home';

import DefaultMode from './DefaultMode';
import SearchMode from './SearchMode';

const SessionListContent = memo(() => {
  const isSearching = useHomeStore((s) => s.isAgentSearching);

  return isSearching ? <SearchMode /> : <DefaultMode />;
});

SessionListContent.displayName = 'SessionListContent';

export default SessionListContent;
