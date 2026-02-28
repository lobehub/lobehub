'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import NavHeader from '@/features/NavHeader';

import Sidebar from './Sidebar';
import { styles } from './style';

const BenchLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <NavHeader style={{ left: 0, position: 'absolute', top: 0, zIndex: 10 }} />
        <Outlet />
      </Flexbox>
    </>
  );
};

export default BenchLayout;
