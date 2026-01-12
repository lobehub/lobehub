'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import AgentIdSync from '@/app/[variants]/(main)/agent/_layout/AgentIdSync';
import ChatHeader from '@/app/[variants]/(mobile)/chat/features/ChatHeader';
import MobileContentLayout from '@/components/server/MobileNavLayout';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';

import { styles } from './style';

const Layout: FC = () => {
  useInitAgentConfig();

  return (
    <>
      <MobileContentLayout className={styles.mainContainer} header={<ChatHeader />}>
        <Outlet />
      </MobileContentLayout>
      <AgentIdSync />
    </>
  );
};

Layout.displayName = 'MobileChatLayout';

export default Layout;
