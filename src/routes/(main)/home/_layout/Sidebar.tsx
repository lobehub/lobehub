import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import SidebarContent from './SidebarContent';

// Home stays registered while React Activity keeps its layout alive. NavPanelHost
// selects content by pathname, so a Home update can no longer overwrite the
// currently active route's entry.
const Sidebar = memo(() => (
  <NavPanelPortal navKey="home">
    <SidebarContent />
  </NavPanelPortal>
));

export default Sidebar;
