'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';

import Sidebar from './Sidebar';
import { styles } from './style';

const HomeLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <SWRConfig value={{ suspense: true }}>
          <SuspenseRouteBoundary>
            <Outlet />
          </SuspenseRouteBoundary>
        </SWRConfig>
      </Flexbox>
    </>
  );
};

export default HomeLayout;
