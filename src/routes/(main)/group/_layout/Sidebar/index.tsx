import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import GroupSidebarContent from './Content';

const Sidebar = () => {
  return (
    <NavPanelPortal navKey="group">
      <GroupSidebarContent />
    </NavPanelPortal>
  );
};

export default Sidebar;
