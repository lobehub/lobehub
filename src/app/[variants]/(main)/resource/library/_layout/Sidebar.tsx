'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import LibraryHierarchy from '@/features/ResourceManager/components/LibraryHierarchy';

import Header from './Header';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="resourceLibrary">
      <SideBarLayout body={<LibraryHierarchy />} header={<Header />} />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'LibrarySidebar';

export default Sidebar;
