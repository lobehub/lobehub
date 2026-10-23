'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { AgentNotFoundGuard } from '@/features/AgentNotFound';
import ChatHeader from '@/routes/(mobile)/chat/features/ChatHeader';

import { styles } from './style';

// Agent init and id sync live one level up in the agent scope layout
// (`(mobile)/agent/_layout`), which the chat shares with the sub-pages.
const Layout: FC = () => (
  <MobileContentLayout className={styles.mainContainer} header={<ChatHeader />}>
    {/* Same 404 fallback as the desktop agent layout: only the content area
        collapses when the routed agent is gone or turned private. */}
    <AgentNotFoundGuard>
      <Outlet />
    </AgentNotFoundGuard>
  </MobileContentLayout>
);

export default Layout;
