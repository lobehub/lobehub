import React, { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import ConfigPanel from './ConfigPanel';
import Header from './Header';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="image">
      <SideBarLayout body={<ConfigPanel />} header={<Header />} />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'ImageSidebar';

export default Sidebar;
