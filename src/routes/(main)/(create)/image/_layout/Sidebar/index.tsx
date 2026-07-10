'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import ImageSidebarContent from './Content';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="image">
    <ImageSidebarContent />
  </NavPanelPortal>
));

Sidebar.displayName = 'ImageSidebar';

export default Sidebar;
