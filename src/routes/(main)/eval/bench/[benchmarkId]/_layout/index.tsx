'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import NavHeader from '@/features/NavHeader';

import Sidebar from './Sidebar';
import { styles } from './style';

const BenchLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox {...stylex.props(styles.mainContainer)} flex={1} height={'100%'}>
        <NavHeader style={{ left: 0, position: 'absolute', top: 0, zIndex: 10 }} />
        <Outlet />
      </Flexbox>
    </>
  );
};

export default BenchLayout;
