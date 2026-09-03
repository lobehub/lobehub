'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';

const EvalLayout: FC = () => {
  return (
    <SWRConfig value={{ suspense: true }}>
      <SuspenseRouteBoundary>
        <Outlet />
      </SuspenseRouteBoundary>
    </SWRConfig>
  );
};

export default EvalLayout;
