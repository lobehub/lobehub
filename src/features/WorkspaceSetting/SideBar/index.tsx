'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import WorkspaceSettingsSideBarContent from './Content';

const SideBar = memo(() => {
  return (
    <NavPanelPortal navKey={'workspace-settings'}>
      <WorkspaceSettingsSideBarContent />
    </NavPanelPortal>
  );
});

export default SideBar;
