'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import LibraryHierarchy from '@/features/ResourceManager/components/LibraryHierarchy';

import Header from './Header';

const Sidebar = () => {
  return (
    <NavPanelPortal navKey="resourceLibrary">
      <SideBarLayout body={<LibraryHierarchy />} header={<Header />} />
    </NavPanelPortal>
  );
};

export default Sidebar;
