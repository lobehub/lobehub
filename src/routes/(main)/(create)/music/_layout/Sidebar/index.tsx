'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import MusicSidebarContent from './Content';

const Sidebar = () => (
  <NavPanelPortal navKey="music">
    <MusicSidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
