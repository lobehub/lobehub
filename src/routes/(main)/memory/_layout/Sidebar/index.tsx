import React, { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

import MemorySidebarContent from './Content';

const Sidebar = memo(() => (
  <NavPanelPortal navKey="memory">
    <MemorySidebarContent />
  </NavPanelPortal>
));

Sidebar.displayName = 'MemorySidebar';

export default Sidebar;
