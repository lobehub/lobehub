'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import VideoSidebarContent from './Content';

const Sidebar = () => (
  <NavPanelPortal navKey="video">
    <VideoSidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
