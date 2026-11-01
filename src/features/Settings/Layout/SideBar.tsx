'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import SidebarContent from './SidebarContent';

const Sidebar = () => {
  return (
    <NavPanelPortal navKey="settings">
      <SidebarContent />
    </NavPanelPortal>
  );
};

export default Sidebar;
