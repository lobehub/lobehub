'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import MobilePageLayout from '@/features/MobileShell/PageLayout';

import DataSync from './PageLayout/DataSync';

/**
 * Mobile `/page/*`: `DataSync` hands the page store its router `navigate`, which
 * create/select use to open the new page. The desktop sidebar is left out —
 * on mobile the list is the `/page` index itself.
 */
const MobilePagesLayout: FC = () => (
  <>
    <MobilePageLayout>
      <Outlet />
    </MobilePageLayout>
    <DataSync />
  </>
);

export default MobilePagesLayout;
