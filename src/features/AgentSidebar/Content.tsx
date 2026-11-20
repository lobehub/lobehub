import { getAgentProfileTab } from '@/features/AgentProfileTabs/tabOptions';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { isMobileSurface } from '@/utils/mobileSurface';

import Body from './Body';
import Header from './Header';
import ProfileNav from './ProfileNav';

const AgentSidebarContent = () => {
  const { pathname } = useActiveLocation();
  // Mobile keeps the header Segmented; this panel is only its chat drawer there.
  const profileTab = isMobileSurface() ? undefined : getAgentProfileTab(pathname);

  if (profileTab) return <ProfileNav active={profileTab} />;

  return <SideBarLayout body={<Body />} header={<Header />} />;
};

export default AgentSidebarContent;
