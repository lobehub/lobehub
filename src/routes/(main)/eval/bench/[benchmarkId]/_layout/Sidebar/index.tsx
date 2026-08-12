'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const Sidebar = () => {
  return (
    <NavPanelPortal navKey="evalBench">
      <SideBarLayout body={<Body />} header={<Header />} />
    </NavPanelPortal>
  );
};

export default Sidebar;
