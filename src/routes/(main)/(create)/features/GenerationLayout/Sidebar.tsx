'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';
import type { GenerationLayoutCommonProps } from './types';

const Sidebar = memo<GenerationLayoutCommonProps>((props) => {
  const { navKey } = props;
  return (
    <NavPanelPortal navKey={navKey}>
      <SideBarLayout body={<Body {...props} />} header={<Header {...props} />} />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'GenerationLayoutSidebar';

export default Sidebar;
