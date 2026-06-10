import React, { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import AgentSidebarContent from './Content';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="agent">
      <AgentSidebarContent />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'ChatSidebar';

export default Sidebar;
