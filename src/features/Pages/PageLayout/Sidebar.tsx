'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import SidebarContent from './SidebarContent';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="page">
    <SidebarContent />
  </NavPanelPortal>
));

Sidebar.displayName = 'PageSidebar';

export default Sidebar;
