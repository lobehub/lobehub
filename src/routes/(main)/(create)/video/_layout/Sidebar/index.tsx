'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import VideoSidebarContent from './Content';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="image">
    <VideoSidebarContent />
  </NavPanelPortal>
));

Sidebar.displayName = 'VideoSidebar';

export default Sidebar;
