'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import RegisterHotkeys from './RegisterHotkeys';

const ResourceLayout: FC = () => {
  return (
    <>
      <Outlet />
      <RegisterHotkeys />
    </>
  );
};

export default ResourceLayout;
