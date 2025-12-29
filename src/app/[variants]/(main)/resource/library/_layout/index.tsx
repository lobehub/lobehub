'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import RegisterHotkeys from '@/app/[variants]/(main)/resource/library/features/RegisterHotkeys';

import Sidebar from './Sidebar';
import { styles } from './style';

const LibraryLayout: FC = () => {
  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
      <RegisterHotkeys />
    </>
  );
};

LibraryLayout.displayName = 'ResourceLibraryLayout';

export default LibraryLayout;
