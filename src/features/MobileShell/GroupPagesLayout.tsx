'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import { GroupNotFoundGuard } from '@/features/GroupNotFound';

import MobilePageLayout from './PageLayout';

/** Full-screen group sub-pages (profile, permission) with the group 404 fallback. */
const MobileGroupPagesLayout: FC = () => (
  <MobilePageLayout>
    <GroupNotFoundGuard>
      <Outlet />
    </GroupNotFoundGuard>
  </MobilePageLayout>
);

export default MobileGroupPagesLayout;
