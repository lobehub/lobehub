'use client';

import { memo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useHomeStore } from '@/store/home';

import AllAgentsDrawer from '../AllAgentsDrawer';
import AgentListContent from './AgentListContent';
import WorkspaceAgentListContent from './WorkspaceAgentListContent';

// The Home sidebar owns the all-agents drawer; other surfaces should import AgentListContent directly.
const AgentList = memo<{ onMoreClick?: () => void }>(({ onMoreClick }) => {
  const [allAgentsDrawerOpen, closeAllAgentsDrawer] = useHomeStore((s) => [
    s.allAgentsDrawerOpen,
    s.closeAllAgentsDrawer,
  ]);
  // A workspace merges shared and private rows into one Agents section with
  // team / personal pin groups; personal mode keeps the original layout.
  const activeWorkspaceId = useActiveWorkspaceId();

  return (
    <>
      {activeWorkspaceId ? (
        <WorkspaceAgentListContent />
      ) : (
        <AgentListContent onMoreClick={onMoreClick} />
      )}
      <AllAgentsDrawer open={allAgentsDrawerOpen} onClose={closeAllAgentsDrawer} />
    </>
  );
});

export default AgentList;
