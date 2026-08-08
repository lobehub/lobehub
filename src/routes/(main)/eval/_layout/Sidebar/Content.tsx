'use client';

import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const EvalSidebarContent = memo(() => <SideBarLayout body={<Body />} header={<Header />} />);

EvalSidebarContent.displayName = 'EvalSidebarContent';

export default EvalSidebarContent;
