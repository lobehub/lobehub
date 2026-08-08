import { memo } from 'react';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import HomeSidebarContent from './Content';

const HomeNavPanelPortal = memo(() => (
  <NavPanelPortal navKey="home">
    <HomeSidebarContent />
  </NavPanelPortal>
));

HomeNavPanelPortal.displayName = 'HomeNavPanelPortal';

export default HomeNavPanelPortal;
