import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel';

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
