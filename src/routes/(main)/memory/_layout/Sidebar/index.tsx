import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import MemorySidebarContent from './Content';

const Sidebar = () => (
  <NavPanelPortal navKey="memory">
    <MemorySidebarContent />
  </NavPanelPortal>
);

export default Sidebar;
