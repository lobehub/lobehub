'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import FileTree from '@/features/ResourceManager/components/Tree';

import Header from './Header';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="resourceLibrary">
      <SideBarLayout body={<FileTree />} header={<Header />} />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'LibrarySidebar';

export default Sidebar;
