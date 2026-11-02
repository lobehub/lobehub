import { NotebookPenIcon } from 'lucide-react';
import type { RouteObject } from 'react-router';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';
import { dynamicElement } from '@/utils/router';

/**
 * `/note` pages. Mounted by the desktop router under the Quick Note layout and
 * reused by the mobile router (`mobileWorkspaceRoutes.tsx`).
 */
export const noteChildren: RouteObject[] = [
  {
    element: dynamicElement(() => import('@/routes/(main)/note'), 'Desktop > Note', {
      preloadId: 'note',
    }),
    handle: {
      meta: routeMeta({
        Skeleton: createSurfaceSkeleton('list'),
        icon: NotebookPenIcon,
        titleKey: 'navigation.note',
      }),
    },
    index: true,
  },
  {
    element: dynamicElement(() => import('@/routes/(main)/note/[id]'), 'Desktop > Note > Detail'),
    handle: {
      meta: routeMeta({
        Skeleton: createSurfaceSkeleton('editor'),
        icon: NotebookPenIcon,
        titleKey: 'navigation.note',
      }),
    },
    path: ':id',
  },
];
