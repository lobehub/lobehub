'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import VideoSidebarContent from './Content';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="video">
    <VideoSidebarContent />
  </NavPanelPortal>
));

Sidebar.displayName = 'VideoSidebar';

export default Sidebar;
