'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import Sidebar from './Sidebar';
import { styles } from './style';

const DesktopMemoryLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={stylex.props(styles.mainContainer).className} flex={1} height={'100%'}>
        <RouteSkeletonChromeProvider>
          <Outlet />
        </RouteSkeletonChromeProvider>
      </Flexbox>
    </>
  );
};

export default DesktopMemoryLayout;
