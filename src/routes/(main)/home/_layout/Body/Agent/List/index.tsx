'use client';

import { memo } from 'react';

import { useHomeStore } from '@/store/home';

import AllAgentsDrawer from '../AllAgentsDrawer';
import AgentListContent from './AgentListContent';

// The Home sidebar owns the all-agents drawer; other surfaces should import AgentListContent directly.
const AgentList = memo<{ onMoreClick?: () => void }>(({ onMoreClick }) => {
  const [allAgentsDrawerOpen, closeAllAgentsDrawer] = useHomeStore((s) => [
    s.allAgentsDrawerOpen,
    s.closeAllAgentsDrawer,
  ]);

  return (
    <>
      <AgentListContent onMoreClick={onMoreClick} />
      <AllAgentsDrawer open={allAgentsDrawerOpen} onClose={closeAllAgentsDrawer} />
    </>
  );
});

export default AgentList;
