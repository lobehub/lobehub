'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import WorkspaceSettingsSideBarContent from './Content';

const SideBar = () => {
  return (
    <NavPanelPortal navKey={'workspace-settings'}>
      <WorkspaceSettingsSideBarContent />
    </NavPanelPortal>
  );
};

export default SideBar;
