import type { RouteObject } from 'react-router';

import { acceptanceRouteMeta } from '@/features/Acceptance/routeMeta';
import { projectAcceptanceRouteMeta } from '@/features/Projects/routeMeta';
import { dynamicElement, dynamicLayout } from '@/utils/router';

const projectAcceptanceDetailElement = (name: string) =>
  dynamicElement(
    () => import('@/routes/(main)/project/[projectId]/acceptance/[acceptanceId]'),
    name,
  );

/**
 * `project/:projectId/acceptance`: the project's acceptances as a full-width
 * list, and each record (or one of its checks) on its own page inside the
 * project. Mounted under the project layout in `desktopRouter.shared.tsx`.
 */
export const projectAcceptanceRoute: RouteObject = {
  children: [
    {
      element: dynamicElement(
        () => import('@/routes/(main)/project/[projectId]/acceptance'),
        'Desktop > Project Acceptance > List',
      ),
      index: true,
    },
    {
      element: projectAcceptanceDetailElement('Desktop > Project Acceptance > Detail'),
      handle: { meta: acceptanceRouteMeta },
      path: ':acceptanceId',
    },
    {
      element: projectAcceptanceDetailElement('Desktop > Project Acceptance > Check'),
      handle: { meta: acceptanceRouteMeta },
      path: ':acceptanceId/check/:checkId',
    },
  ],
  element: dynamicLayout(
    () => import('@/routes/(main)/project/[projectId]/acceptance/_layout'),
    'Desktop > Project Acceptance',
  ),
  handle: { meta: projectAcceptanceRouteMeta },
  path: 'acceptance',
};
