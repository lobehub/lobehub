import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import AgentIdSync from '@/app/[variants]/(main)/agent/_layout/AgentIdSync';
import { isDesktop } from '@/const/version';
import ProtocolUrlHandler from '@/features/ProtocolUrlHandler';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';

import RegisterHotkeys from './RegisterHotkeys';
import Sidebar from './Sidebar';
import { styles } from './style';

const Layout: FC = () => {
  useInitAgentConfig();

  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
      {/* ↓ cloud slot ↓ */}

      {/* ↑ cloud slot ↑ */}
      <RegisterHotkeys />
      {isDesktop && <ProtocolUrlHandler />}
      <AgentIdSync />
    </>
  );
};

Layout.displayName = 'DesktopChatLayout';

export default Layout;
