'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import AreaSwitch from '@/features/LobeBench/AreaSwitch';
import Sidebar from '@/features/LobeBench/Layout/Sidebar';
import { useNarrowBenchNavigation } from '@/features/LobeBench/useNarrowBenchNavigation';
import NavHeader from '@/features/NavHeader';
import { styles } from '@/routes/(main)/eval/_layout/style';

const LobeBenchLayout: FC = () => {
  useNarrowBenchNavigation();
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'} style={{ minWidth: 0 }}>
        <NavHeader
          style={{
            left: 0,
            pointerEvents: 'none',
            position: 'absolute',
            right: 0,
            top: 0,
            zIndex: 10,
          }}
          styles={{
            center: { ...AGENT_PROFILE_TABS_CENTER_STYLE, pointerEvents: 'auto' },
            left: { pointerEvents: 'auto' },
          }}
        >
          <AreaSwitch active={'bench'} />
        </NavHeader>
        <Outlet />
      </Flexbox>
    </>
  );
};

export default LobeBenchLayout;
