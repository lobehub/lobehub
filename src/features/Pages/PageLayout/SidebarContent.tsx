'use client';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const PageSidebarContent = () => <SideBarLayout body={<Body />} header={<Header />} />;

export default PageSidebarContent;
