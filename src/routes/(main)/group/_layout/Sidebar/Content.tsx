import React, { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const GroupSidebarContent = memo(() => {
  return <SideBarLayout body={<Body />} header={<Header />} />;
});

GroupSidebarContent.displayName = 'GroupSidebarContent';

export default GroupSidebarContent;
