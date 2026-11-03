'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import SidebarContent from './SidebarContent';

const Sidebar = () => (
  <NavPanelPortal navKey="page">
    <SidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
