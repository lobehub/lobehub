import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import AgentSidebarContent from './Content';

const Sidebar = () => {
  return (
    <NavPanelPortal navKey="agent">
      <AgentSidebarContent />
    </NavPanelPortal>
  );
};

export default Sidebar;
