'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="evalBench">
      <SideBarLayout body={<Body />} header={<Header />} />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'BenchSidebar';

export default Sidebar;
