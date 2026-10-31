'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC } from 'react';
import { Outlet } from 'react-router';

import Sidebar from './Sidebar';
import { styles } from './style';

const HomeLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={stylex.props(styles.mainContainer).className} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
    </>
  );
};

export default HomeLayout;
