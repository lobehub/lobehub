import { Navigate, type RouteObject, useLocation, useParams } from 'react-router';

import { goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { dashboardRouteMeta, dashboardsRouteMeta } from '@/features/Dashboard/routeMeta';
import {
  projectConversationRouteMeta,
  projectDirectoriesRouteMeta,
  projectHomeRouteMeta,
} from '@/features/Projects/routeMeta';
import { projectAcceptanceRoute } from '@/spa/router/projectAcceptanceRoutes';
import { scheduledTaskListLoader } from '@/spa/router/scheduledTaskListLoader';
import { dynamicElement, dynamicLayout, ErrorBoundary } from '@/utils/router';

/** Topics used to live under `conversation/`: keep old links and restored tabs working. */
const LegacyProjectConversationRedirect = () => {
  const { topicId } = useParams<{ topicId?: string }>();
  const { hash, search } = useLocation();
  const pathname = topicId ? `../../topic/${topicId}` : '../topic';

  return <Navigate replace relative="path" to={{ hash, pathname, search }} />;
};

/**
 * One project's workspace under `/project/:projectId`: its home, topics, tasks,
 * settings, goals, dashboards and acceptance. Mounted under the workspace
 * layout in `desktopRouter.shared.tsx`.
 */
export const projectWorkspaceRoute: RouteObject = {
  children: [
    {
      element: dynamicElement(
        () => import('@/routes/(main)/project/[projectId]'),
        'Desktop > Project Home',
        { preloadId: 'project-home' },
      ),
      handle: { meta: projectHomeRouteMeta },
      index: true,
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/project/[projectId]/topic'),
        'Desktop > Project Topic',
        { preloadId: 'project-topic' },
      ),
      handle: { meta: projectConversationRouteMeta },
      path: 'topic/:topicId?',
    },
    { element: <LegacyProjectConversationRedirect />, path: 'conversation/:topicId?' },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/project/[projectId]/tasks'),
        'Desktop > Project Tasks',
      ),
      handle: { meta: tasksRouteMeta },
      loader: scheduledTaskListLoader,
      path: 'tasks',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/project/[projectId]/settings'),
        'Desktop > Project Working Directories',
        { preloadId: 'project-settings' },
      ),
      handle: { meta: projectDirectoriesRouteMeta },
      path: 'settings/:section?',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/project/[projectId]/goals'),
        'Desktop > Project Goals',
      ),
      handle: { meta: goalsRouteMeta },
      path: 'goals',
    },
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/project/[projectId]/dashboard'),
            'Desktop > Project Dashboards',
            { preloadId: 'dashboard' },
          ),
          handle: { meta: dashboardsRouteMeta },
          index: true,
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/project/[projectId]/dashboard/[dashboardId]'),
            'Desktop > Project Dashboard Detail',
            { preloadId: 'dashboard' },
          ),
          handle: { meta: dashboardRouteMeta },
          path: ':dashboardId',
        },
      ],
      // Off unless the `dashboard` feature flag is on: the gate leaves for the project.
      element: dynamicLayout(
        () => import('@/routes/(main)/project/[projectId]/dashboard/_layout'),
        'Desktop > Project Dashboards > Layout',
        { preloadId: 'dashboard' },
      ),
      path: 'dashboard',
    },
    projectAcceptanceRoute,
  ],
  element: dynamicLayout(
    () => import('@/routes/(main)/project/_layout'),
    'Desktop > Project Workspace > Layout',
    { preloadId: 'project' },
  ),
  errorElement: <ErrorBoundary resetPath=".." />,
  path: 'project/:projectId',
};
