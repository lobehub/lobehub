'use client';

import type { RouteObject } from 'react-router';
import { Outlet } from 'react-router';

import ControlPlaneShell from '@/features/ControlPlaneShell';
import ControlPlaneAuthGate from '@/features/ControlPlaneShell/ControlPlaneAuthGate';
import { PlatformAdminPanel } from '@/features/PlatformAdmin';
import SettingContainer from '@/features/Setting/SettingContainer';
import { ErrorBoundary } from '@/utils/router';

const PlatformAdminPage = () => (
  <ControlPlaneAuthGate>
    <SettingContainer>
      <PlatformAdminPanel />
    </SettingContainer>
  </ControlPlaneAuthGate>
);

const ControlPlaneLayout = () => (
  <ControlPlaneShell>
    <Outlet />
  </ControlPlaneShell>
);

export const controlPlaneRoutes: RouteObject[] = [
  {
    children: [
      {
        element: <PlatformAdminPage />,
        errorElement: <ErrorBoundary />,
        index: true,
      },
    ],
    element: <ControlPlaneLayout />,
    path: '/',
  },
];
