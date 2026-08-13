'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import ImageSidebarContent from './Content';

const Sidebar = () => (
  <NavPanelPortal navKey="image">
    <ImageSidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
