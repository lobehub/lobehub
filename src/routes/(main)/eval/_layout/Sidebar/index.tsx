'use client';

import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import EvalSidebarContent from './Content';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="eval">
    <EvalSidebarContent />
  </NavPanelPortal>
));

Sidebar.displayName = 'EvalSidebar';

export default Sidebar;
