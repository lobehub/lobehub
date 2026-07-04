'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, useMemo } from 'react';
import { Outlet } from 'react-router';

import SideBar from '@/routes/(main)/settings/_layout/SideBar';

import SettingsContextProvider from './ContextProvider';
import { styles } from './style';

const Layout: FC = () => {
  const contextValue = useMemo(
    () => ({ showOpenAIApiKey: true, showOpenAIProxyUrl: true }),
    [],
  );

  return (
    <SettingsContextProvider value={contextValue}>
      <SideBar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
    </SettingsContextProvider>
  );
};

export default Layout;
