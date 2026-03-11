import React, { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="group">
      <SideBarLayout body={<Body />} header={<Header />} />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'ChatSidebar';

export default Sidebar;
