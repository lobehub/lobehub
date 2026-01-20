'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import DataSync from './DataSync';
import Sidebar from './Sidebar';
import { styles } from './style';

const DesktopPagesLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
      <DataSync />
    </>
  );
};

export default DesktopPagesLayout;
