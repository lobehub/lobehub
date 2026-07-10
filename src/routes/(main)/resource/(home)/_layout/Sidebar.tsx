'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import SidebarContent from './SidebarContent';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="resource">
    <SidebarContent />
  </NavPanelPortal>
));

Sidebar.displayName = 'ResourceHomeSidebar';

export default Sidebar;
