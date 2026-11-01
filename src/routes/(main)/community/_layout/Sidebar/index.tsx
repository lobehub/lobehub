import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import Content from './Content';

const Sidebar = () => {
  return (
    <NavPanelPortal navKey="discover">
      <Content />
    </NavPanelPortal>
  );
};

export default Sidebar;
