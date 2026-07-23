'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { AgentNotFoundGuard } from '@/features/AgentNotFound';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import AgentIdSync from '@/routes/(main)/agent/_layout/AgentIdSync';
import ChatHeader from '@/routes/(mobile)/chat/features/ChatHeader';

import { styles } from './style';

const Layout: FC = () => {
  useInitAgentConfig();

  return (
    <>
      <MobileContentLayout className={styles.mainContainer} header={<ChatHeader />}>
        {/* Same 404 fallback as the desktop agent layout: only the content
            area collapses when the routed agent is gone or turned private. */}
        <AgentNotFoundGuard>
          <Outlet />
        </AgentNotFoundGuard>
      </MobileContentLayout>
      <AgentIdSync />
    </>
  );
};

export default Layout;
