'use client';

import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const WorkspaceSettingsSideBarContent = memo(() => (
  <SideBarLayout body={<Body />} header={<Header />} />
));

WorkspaceSettingsSideBarContent.displayName = 'WorkspaceSettingsSideBarContent';

export default WorkspaceSettingsSideBarContent;
