'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import AreaSwitch from '@/features/LobeBench/AreaSwitch';
import NavHeader from '@/features/NavHeader';

import Sidebar from '../../_layout/Sidebar';
import { styles } from '../../_layout/style';

const EvalHomeLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        {/* Spans the whole header band so the area switch can sit at its
            centre; the band itself lets clicks through to the page. */}
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
          <AreaSwitch active={'agent'} />
        </NavHeader>
        <Outlet />
      </Flexbox>
    </>
  );
};

export default EvalHomeLayout;
