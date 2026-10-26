'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import { DndContextWrapper } from '@/features/ResourceManager/DndContextWrapper';

import MobilePageLayout from './PageLayout';

/**
 * Resource explorer rows and library tree nodes read the drag context and throw
 * without it. Desktop provides it from the root layout; mobile only needs it here.
 */
const MobileResourceLayout: FC = () => (
  <DndContextWrapper>
    <MobilePageLayout>
      <Outlet />
    </MobilePageLayout>
  </DndContextWrapper>
);

export default MobileResourceLayout;
