'use client';

import { memo, useCallback, useRef } from 'react';

import { type SideBarDrawerHandle } from '@/features/NavPanel/SideBarDrawer';

import AllAgentsDrawer from '../AllAgentsDrawer';
import AgentListContent from './AgentListContent';

// The Home sidebar owns the all-agents drawer; other surfaces should import AgentListContent directly.
const AgentList = memo<{ onMoreClick?: () => void }>(({ onMoreClick }) => {
  const drawerRef = useRef<SideBarDrawerHandle>(null);
  const openDrawer = useCallback(() => drawerRef.current?.open(), []);

  return (
    <>
      <AgentListContent onMoreClick={onMoreClick ?? openDrawer} />
      <AllAgentsDrawer ref={drawerRef} />
    </>
  );
});

export default AgentList;
