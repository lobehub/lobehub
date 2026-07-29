import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import Content from './Content';

const Sidebar = memo(() => {
  return (
    <NavPanelPortal navKey="discover">
      <Content />
    </NavPanelPortal>
  );
});

Sidebar.displayName = 'DisocverSidebar';

export default Sidebar;
