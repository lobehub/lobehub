'use client';

import type { RouteObject } from 'react-router-dom';

import PopupLayout from '@/routes/(popup)/_layout';
import PopupAgentQuickPage from '@/routes/(popup)/agent/[aid]';
import PopupAgentTopicPage from '@/routes/(popup)/agent/[aid]/[tid]';
import PopupGroupTopicPage from '@/routes/(popup)/group/[gid]/[tid]';
import { ErrorBoundary, redirectElement } from '@/utils/router';

// Popup router configuration — dedicated SPA entry for single-topic windows.
// Desktop-only; no sidebar, no portal, hosts a single conversation per window.
export const popupRoutes: RouteObject[] = [
  {
    children: [
      {
        element: <PopupAgentTopicPage />,
        path: 'agent/:aid/:tid',
      },
      {
        element: <PopupAgentQuickPage />,
        path: 'agent/:aid',
      },
      {
        element: <PopupGroupTopicPage />,
        path: 'group/:gid/:tid',
      },
      {
        element: redirectElement('/popup'),
        path: '*',
      },
    ],
    element: <PopupLayout />,
    errorElement: <ErrorBoundary resetPath="/popup" />,
    path: '/popup',
  },
];
