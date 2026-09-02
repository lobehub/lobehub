'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import SideBar from '@/features/Settings/Layout/SideBar';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

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
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <SWRConfig value={{ suspense: true }}>
          <SuspenseRouteBoundary>
            <RouteSkeletonChromeProvider>
              <Outlet />
            </RouteSkeletonChromeProvider>
          </SuspenseRouteBoundary>
        </SWRConfig>
      </Flexbox>
    </SettingsContextProvider>
  );
};

export default Layout;
