import React, { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Header from './Header';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="discover">
      <SideBarLayout header={<Header />} />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'DisocverSidebar';

export default Sidebar;
