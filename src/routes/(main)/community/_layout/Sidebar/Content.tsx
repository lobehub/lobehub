import { lazy } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import Header from './Header';

const InstalledSkills = lazy(() =>
  import('@/features/CommunitySkills/InstalledSkills').then((m) => ({
    default: m.InstalledSkills,
  })),
);

const InstalledMcp = lazy(() =>
  import('@/features/CommunityMcp/InstalledMcp').then((m) => ({ default: m.InstalledMcp })),
);

const Content = () => {
  const { pathname } = useActiveLocation();
  const signedIn = Boolean(useUserStore(authSelectors.isLogin));
  const section = pathname.split('/community/')[1]?.split('/')[0];
  const body =
    section === 'skill' ? <InstalledSkills /> : signedIn && section === 'mcp' && <InstalledMcp />;

  return <SideBarLayout body={body} header={<Header />} />;
};

export default Content;
