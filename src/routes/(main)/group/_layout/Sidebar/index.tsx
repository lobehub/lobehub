import React, { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import GroupSidebarContent from './Content';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="group">
      <GroupSidebarContent />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'ChatSidebar';

export default Sidebar;
