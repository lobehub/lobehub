import { getAgentProfileTab } from '@/features/AgentProfileTabs/tabOptions';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { isShareVisitorRoute } from '@/features/ShareVisitorTopics/latestVisitorTopic';
import ShareVisitorSidebarNav from '@/features/ShareVisitorTopics/SidebarNav';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { isMobileSurface } from '@/utils/mobileSurface';

import Body from './Body';
import Header from './Header';
import ProfileNav from './ProfileNav';

const AgentSidebarContent = () => {
  const { pathname } = useActiveLocation();
  // Visitors' conversations are someone else's topics, so they get their own sidebar instead of
  // mixing into the Agent's topic list.
  if (isShareVisitorRoute(pathname)) return <ShareVisitorSidebarNav />;

  // Mobile keeps the header Segmented; this panel is only its chat drawer there.
  const profileTab = isMobileSurface() ? undefined : getAgentProfileTab(pathname);

  if (profileTab) return <ProfileNav active={profileTab} />;

  return <SideBarLayout body={<Body />} header={<Header />} />;
};

export default AgentSidebarContent;
