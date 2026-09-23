'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import SidebarContent from './SidebarContent';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="note">
    <SidebarContent />
  </NavPanelPortal>
));

Sidebar.displayName = 'QuickNoteSidebar';

export default Sidebar;
