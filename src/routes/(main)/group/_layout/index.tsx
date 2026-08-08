import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import { isDesktop } from '@/const/version';
import { GroupNotFoundGuard } from '@/features/GroupNotFound';
import ProtocolUrlHandler from '@/features/ProtocolUrlHandler';
import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';

import GroupIdSync from './GroupIdSync';
import RegisterHotkeys from './RegisterHotkeys';
import Sidebar from './Sidebar';
import { styles } from './style';

const Layout: FC = () => {
  useInitGroupConfig();

  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        {/* Keep the sidebar interactive when the routed group is gone (deleted
            or made private) — only the content area collapses to the 404 card. */}
        <GroupNotFoundGuard>
          <Outlet />
        </GroupNotFoundGuard>
      </Flexbox>
      <RegisterHotkeys />
      {isDesktop && <ProtocolUrlHandler />}
      <GroupIdSync />
    </>
  );
};

export default Layout;
