import React, { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

const AgentSidebarContent = memo(() => {
  return <SideBarLayout body={<Body />} header={<Header />} />;
});

AgentSidebarContent.displayName = 'AgentSidebarContent';

export default AgentSidebarContent;
