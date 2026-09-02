'use client';

import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const QuickNoteSidebarContent = memo(() => <SideBarLayout body={<Body />} header={<Header />} />);

QuickNoteSidebarContent.displayName = 'QuickNoteSidebarContent';

export default QuickNoteSidebarContent;
