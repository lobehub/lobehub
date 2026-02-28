'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import AgentIdSync from '@/routes/(main)/agent/_layout/AgentIdSync';
import ChatHeader from '@/routes/(mobile)/chat/features/ChatHeader';
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

export default Layout;
