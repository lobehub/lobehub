import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import SidebarContent from './SidebarContent';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="home">
      <SidebarContent />
    </NavPanelPortal>
  );
});

export default Sidebar;
