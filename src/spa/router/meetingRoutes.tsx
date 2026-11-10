import type { RouteObject } from 'react-router';

import { meetingDetailRouteMeta, meetingsRouteMeta } from '@/features/Meeting/routeMeta';
import { dynamicElement, ErrorBoundary } from '@/utils/router';

/**
 * Meeting notes: `/meeting` lists the recordings and `/meeting/:meetingId`
 * opens one. The floating recorder is not a route; the app layout mounts it.
 */
export const meetingRoutes: RouteObject[] = [
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/meeting'), 'Desktop > Meetings'),
        handle: { meta: meetingsRouteMeta },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/meeting/[meetingId]'),
          'Desktop > Meeting Detail',
        ),
        handle: { meta: meetingDetailRouteMeta },
        path: ':meetingId',
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'meeting',
  },
];
