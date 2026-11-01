'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import SidebarContent from './SidebarContent';

const Sidebar = () => (
  <NavPanelPortal navKey="resource">
    <SidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
