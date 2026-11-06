'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import DataSync from './DataSync';
import Sidebar from './Sidebar';
import { styles } from './style';

const DesktopPagesLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={stylex.props(styles.mainContainer).className} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
      <DataSync />
    </>
  );
};

export default DesktopPagesLayout;
