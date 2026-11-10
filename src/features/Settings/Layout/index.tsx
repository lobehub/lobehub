'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import SideBar from '@/features/Settings/Layout/SideBar';

import SettingsContextProvider from './ContextProvider';
import { styles } from './style';

const Layout: FC = () => {
  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      <SideBar />
      <Flexbox className={stylex.props(styles.mainContainer).className} flex={1} height={'100%'}>
        {/* The layout draws no header: every tab's route skeleton draws the
            shared settings header with the real tab title itself. */}
        <Outlet />
      </Flexbox>
    </SettingsContextProvider>
  );
};

export default Layout;
