import type { RouteObject } from 'react-router-dom';
import { Outlet } from 'react-router-dom';

import AuthShell from '@/features/AuthShell';

export const authRoutes: RouteObject[] = [
  {
    children: [
      {
        element: null,
        index: true,
      },
    ],
    element: (
      <AuthShell>
        <Outlet />
      </AuthShell>
    ),
    path: '/',
  },
];
