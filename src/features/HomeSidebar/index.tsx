import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import HomeSidebarContent from './Content';

const HomeNavPanelPortal = () => (
  <NavPanelPortal navKey="home">
    <HomeSidebarContent />
  </NavPanelPortal>
);

export default HomeNavPanelPortal;
