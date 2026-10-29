import type { RouteObject } from 'react-router';

import { goalDetailRouteMeta, goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { taskRouteMeta, tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { scheduledTaskListLoader } from '@/spa/router/scheduledTaskListLoader';
import { dynamicElement, ErrorBoundary } from '@/utils/router';

interface TaskWorkspaceOptions {
  /** Debug-name prefix of the lazy segments (`Desktop`, `Mobile`). */
  label: string;
  /** Route-preload task the task list warms (each platform has its own list). */
  preloadId: string;
}

/**
 * The cross-agent task workspace: `/tasks` and `/goals`, and the bare
 * `/task/:taskId` and `/goal/:goalId` details they open. Desktop mounts it
 * under the workspace layout in `desktopRouter.shared.tsx`; mobile mounts the
 * same tree from `mobileWorkspaceRoutes.tsx`.
 */
export const createTaskWorkspaceChildren = ({
  label,
  preloadId,
}: TaskWorkspaceOptions): RouteObject[] => [
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/tasks'), `${label} > Tasks`, {
          preloadId,
        }),
        handle: { meta: tasksRouteMeta },
        index: true,
        loader: scheduledTaskListLoader,
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'tasks',
  },
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/goals'), `${label} > Goals`),
        handle: { meta: goalsRouteMeta },
        index: true,
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'goals',
  },
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/task/[taskId]'),
          `${label} > Task Detail`,
        ),
        handle: { meta: taskRouteMeta },
        // Optional readable title tail — see the agent-scoped `task/:taskId/:slug?`
        // route in `desktopRouter.shared.tsx`.
        path: ':taskId/:slug?',
      },
    ],
    errorElement: <ErrorBoundary resetPath="../tasks" />,
    path: 'task',
  },
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/goal/[goalId]'),
          `${label} > Goal Detail`,
        ),
        handle: { meta: goalDetailRouteMeta },
        path: ':goalId',
      },
    ],
    errorElement: <ErrorBoundary resetPath="../goals" />,
    path: 'goal',
  },
];

export const taskWorkspaceChildren = createTaskWorkspaceChildren({
  label: 'Desktop',
  preloadId: 'tasks',
});
