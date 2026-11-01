'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import { useDocsMergeNotice } from '@/features/ResourceHome/MergeNotice';

import RegisterHotkeys from './RegisterHotkeys';

const ResourceLayout: FC = () => {
  useDocsMergeNotice();

  return (
    <>
      <Outlet />
      <RegisterHotkeys />
    </>
  );
};

export default ResourceLayout;
