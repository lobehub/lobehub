import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import { AgentNotFoundGuard } from '@/features/AgentNotFound';
import AgentSidebar from '@/features/AgentSidebar';
import AgentIdSync from '@/routes/(main)/agent/_layout/AgentIdSync';

import PortalAutoCollapse from './PortalAutoCollapse';
import RegisterHotkeys from './RegisterHotkeys';
import { styles } from './style';

const Layout: FC = () => {
  return (
    <>
      <AgentSidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        {/* Keep the sidebar interactive when the routed agent is gone (deleted
            or made private) — only the content area collapses to the 404 card. */}
        <AgentNotFoundGuard>
          <Outlet />
        </AgentNotFoundGuard>
      </Flexbox>
      <RegisterHotkeys />
      <AgentIdSync />
      <PortalAutoCollapse />
    </>
  );
};

export default Layout;
