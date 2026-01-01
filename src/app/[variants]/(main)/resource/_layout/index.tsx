'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import RegisterHotkeys from './RegisterHotkeys';

const ResourceLayout: FC = () => {
  return (
    <>
      <Outlet />
      <RegisterHotkeys />
    </>
  );
};

ResourceLayout.displayName = 'ResourceLayout';

export default ResourceLayout;
