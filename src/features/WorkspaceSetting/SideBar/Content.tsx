'use client';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Footer from './Footer';
import Header from './Header';

const WorkspaceSettingsSideBarContent = () => (
  <SideBarLayout body={<Body />} footer={<Footer />} header={<Header />} />
);

export default WorkspaceSettingsSideBarContent;
