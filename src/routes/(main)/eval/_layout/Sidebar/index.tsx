'use client';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import EvalSidebarContent from './Content';

const Sidebar = () => (
  <NavPanelPortal navKey="eval">
    <EvalSidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
