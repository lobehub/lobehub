'use client';

import { Outlet } from 'react-router';

import WorkspaceContextSlot from '@/business/client/WorkspaceContextSlot';

const AcceptanceLayout = () => (
  <WorkspaceContextSlot>
    <Outlet />
  </WorkspaceContextSlot>
);

export default AcceptanceLayout;
