'use client';

import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const PageSidebarContent = memo(() => <SideBarLayout body={<Body />} header={<Header />} />);

PageSidebarContent.displayName = 'PageSidebarContent';

export default PageSidebarContent;
