import React, { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Header from './Header';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="memory">
      <SideBarLayout header={<Header />} />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'MemorySidebar';

export default Sidebar;
