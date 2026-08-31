'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';

import RegisterHotkeys from './RegisterHotkeys';

const ResourceLayout: FC = () => {
  return (
    <>
      <SWRConfig value={{ suspense: true }}>
        <SuspenseRouteBoundary>
          <Outlet />
        </SuspenseRouteBoundary>
      </SWRConfig>
      <RegisterHotkeys />
    </>
  );
};

export default ResourceLayout;
