'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import Sidebar from './Sidebar';
import { styles } from './style';

const DesktopMemoryLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <SWRConfig value={{ suspense: true }}>
          <SuspenseRouteBoundary>
            <RouteSkeletonChromeProvider>
              <Outlet />
            </RouteSkeletonChromeProvider>
          </SuspenseRouteBoundary>
        </SWRConfig>
      </Flexbox>
    </>
  );
};

export default DesktopMemoryLayout;
