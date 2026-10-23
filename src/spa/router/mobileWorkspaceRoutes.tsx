'use client';

import { BrainCircuit, FilePenIcon, Image, Scale, Video } from 'lucide-react';
import type { RouteObject } from 'react-router';

import GenerationSkeleton from '@/components/Skeleton/Generation';
import MemorySkeleton from '@/components/Skeleton/Memory';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { acceptanceRouteMeta } from '@/features/Acceptance/routeMeta';
import { goalDetailRouteMeta, goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { taskRouteMeta, tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { dashboardRouteMeta, dashboardsRouteMeta } from '@/features/Dashboard/routeMeta';
import { pageRouteMeta } from '@/features/Pages/routeMeta';
import {
  projectAcceptanceRouteMeta,
  projectConversationRouteMeta,
  projectDirectoriesRouteMeta,
  projectHomeRouteMeta,
  projectsRouteMeta,
} from '@/features/Projects/routeMeta';
import { activityListLoader } from '@/spa/router/activityListLoader';
import { contextListLoader } from '@/spa/router/contextListLoader';
import { identitiesListLoader } from '@/spa/router/identitiesListLoader';
import { pageListLoader } from '@/spa/router/pageListLoader';
import { preferenceListLoader } from '@/spa/router/preferenceListLoader';
import { resourceRoute as desktopResourceRoute } from '@/spa/router/resourceRoutes';
import { routeMeta } from '@/spa/router/routeMeta';
import { scheduledTaskListLoader } from '@/spa/router/scheduledTaskListLoader';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

/**
 * The desktop workspace surfaces (tasks, goals, projects, resources, memory,
 * pages, generation, dashboards) mounted on mobile. Every page reuses its
 * desktop segment; desktop layouts that only paint a sidebar are kept because
 * the sidebar they register opens from the mobile page header as a drawer.
 * Mounted under both `/` and `/:workspaceSlug` by `mobileRouter.config.tsx`.
 */

const pageLayout = (name: string) =>
  dynamicLayout(() => import('@/routes/(mobile)/_page-layout'), name);

const taskWorkspaceRoute: RouteObject = {
  children: [
    {
      children: [
        {
          element: dynamicElement(() => import('@/routes/(main)/tasks'), 'Mobile > Tasks', {
            preloadId: 'mobile-tasks',
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
          element: dynamicElement(() => import('@/routes/(main)/goals'), 'Mobile > Goals'),
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
            'Mobile > Task Detail',
          ),
          handle: { meta: taskRouteMeta },
          // Optional readable title tail; `:taskId` alone resolves the task.
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
            'Mobile > Goal Detail',
          ),
          handle: { meta: goalDetailRouteMeta },
          path: ':goalId',
        },
      ],
      errorElement: <ErrorBoundary resetPath="../goals" />,
      path: 'goal',
    },
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/agent/task/[taskId]'),
            'Mobile > Agent Task Detail',
          ),
          handle: { meta: taskRouteMeta },
          path: ':aid/task/:taskId/:slug?',
        },
      ],
      errorElement: <ErrorBoundary resetPath="../tasks" />,
      path: 'agent',
    },
  ],
  element: dynamicLayout(
    () => import('@/routes/(main)/(task-workspace)/_layout'),
    'Mobile > Task Workspace > Layout',
    { preloadId: 'mobile-tasks' },
  ),
};

const projectRoutes: RouteObject[] = [
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/projects'), 'Mobile > Projects'),
        handle: { meta: projectsRouteMeta },
        index: true,
      },
    ],
    element: pageLayout('Mobile > Projects > Layout'),
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'projects',
  },
  {
    children: [
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/project/[projectId]'),
              'Mobile > Project Home',
            ),
            handle: { meta: projectHomeRouteMeta, mobileShellHeader: true },
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/project/[projectId]/conversation'),
              'Mobile > Project Conversation',
            ),
            handle: { meta: projectConversationRouteMeta },
            path: 'conversation/:topicId?',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/project/[projectId]/tasks'),
              'Mobile > Project Tasks',
            ),
            handle: { meta: tasksRouteMeta },
            loader: scheduledTaskListLoader,
            path: 'tasks',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/project/[projectId]/settings'),
              'Mobile > Project Working Directories',
            ),
            // The settings page opens with its own "Project settings" heading.
            handle: { meta: projectDirectoriesRouteMeta, mobileShellHeader: 'untitled' },
            path: 'settings/:section?',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/project/[projectId]/goals'),
              'Mobile > Project Goals',
            ),
            handle: { meta: goalsRouteMeta },
            path: 'goals',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/project/[projectId]/dashboard'),
                  'Mobile > Project Dashboards',
                ),
                handle: { meta: dashboardsRouteMeta },
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/project/[projectId]/dashboard/[dashboardId]'),
                  'Mobile > Project Dashboard Detail',
                ),
                handle: { meta: dashboardRouteMeta },
                path: ':dashboardId',
              },
            ],
            // Off unless the `dashboard` feature flag is on: the gate leaves for the project.
            element: dynamicLayout(
              () => import('@/routes/(main)/project/[projectId]/dashboard/_layout'),
              'Mobile > Project Dashboards > Layout',
            ),
            path: 'dashboard',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/project/[projectId]/acceptance'),
                  'Mobile > Project Acceptance > List',
                ),
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/project/[projectId]/acceptance/[acceptanceId]'),
                  'Mobile > Project Acceptance > Detail',
                ),
                handle: { meta: acceptanceRouteMeta },
                path: ':acceptanceId',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/project/[projectId]/acceptance/[acceptanceId]'),
                  'Mobile > Project Acceptance > Check',
                ),
                handle: { meta: acceptanceRouteMeta },
                path: ':acceptanceId/check/:checkId',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/project/[projectId]/acceptance/_layout'),
              'Mobile > Project Acceptance',
            ),
            handle: { meta: projectAcceptanceRouteMeta },
            path: 'acceptance',
          },
        ],
        // The `enableProjects` gate, the project detail load and the project
        // sidebar (sections + topics), which mobile opens as a drawer.
        element: dynamicLayout(
          () => import('@/routes/(main)/project/_layout'),
          'Mobile > Project Workspace > Layout',
        ),
      },
    ],
    element: pageLayout('Mobile > Project > Page Layout'),
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'project/:projectId',
  },
];

// The shared Docs subtree (home, drive, works, library gallery, libraries)
// wrapped in the mobile page layout with the drag context its rows need. Reused
// rather than copied, so the mobile tree follows every desktop route change.
const resourceRoute: RouteObject = {
  children: [{ ...desktopResourceRoute, path: undefined }],
  element: dynamicLayout(
    () => import('@/routes/(mobile)/resource/_layout'),
    'Mobile > Resource > Layout',
  ),
  errorElement: <ErrorBoundary />,
  path: 'resource',
};

const memoryRoute: RouteObject = {
  children: [
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/memory/(home)'),
            'Mobile > Memory > Home',
          ),
          handle: {
            meta: routeMeta({
              icon: BrainCircuit,
              Skeleton: MemorySkeleton,
              titleKey: 'navigation.memory',
            }),
          },
          index: true,
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/memory/identities'),
            'Mobile > Memory > Identities',
          ),
          handle: {
            meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryIdentities' }),
          },
          loader: identitiesListLoader,
          path: 'identities',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/memory/contexts'),
            'Mobile > Memory > Contexts',
          ),
          handle: {
            meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryContexts' }),
          },
          loader: contextListLoader,
          path: 'contexts',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/memory/preferences'),
            'Mobile > Memory > Preferences',
          ),
          handle: {
            meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryPreferences' }),
          },
          loader: preferenceListLoader,
          path: 'preferences',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/memory/rules'),
            'Mobile > Memory > Rules',
          ),
          handle: { meta: routeMeta({ icon: Scale, titleKey: 'navigation.memoryRules' }) },
          path: 'rules',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/memory/activities'),
            'Mobile > Memory > Activities',
          ),
          handle: { meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }) },
          loader: activityListLoader,
          path: 'activities',
        },
      ],
      // Section nav sidebar (opened as a drawer on mobile).
      element: dynamicLayout(
        () => import('@/routes/(main)/memory/_layout'),
        'Mobile > Memory > Layout',
      ),
    },
  ],
  element: pageLayout('Mobile > Memory > Page Layout'),
  errorElement: <ErrorBoundary />,
  handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
  path: 'memory',
};

const pageRoute: RouteObject = {
  children: [
    {
      element: dynamicElement(() => import('@/routes/(mobile)/page'), 'Mobile > Page List'),
      handle: {
        meta: routeMeta({
          icon: FilePenIcon,
          Skeleton: createSurfaceSkeleton('list'),
          titleKey: 'navigation.pages',
        }),
      },
      index: true,
    },
    {
      element: dynamicElement(() => import('@/routes/(mobile)/page/[id]'), 'Mobile > Page'),
      handle: { meta: pageRouteMeta },
      path: ':id',
    },
    {
      element: dynamicElement(
        () => import('@/routes/(main)/page/[id]/permission'),
        'Mobile > Page > Permission',
      ),
      handle: { meta: pageRouteMeta },
      path: ':id/permission',
    },
  ],
  element: dynamicLayout(() => import('@/routes/(mobile)/page/_layout'), 'Mobile > Page > Layout'),
  errorElement: <ErrorBoundary />,
  loader: pageListLoader,
  path: 'page',
};

const generationRoute = (kind: 'image' | 'video'): RouteObject => ({
  children: [
    {
      children: [
        {
          element:
            kind === 'image'
              ? dynamicElement(() => import('@/routes/(main)/(create)/image'), 'Mobile > Image')
              : dynamicElement(() => import('@/routes/(main)/(create)/video'), 'Mobile > Video'),
          handle: {
            meta: routeMeta(
              kind === 'image'
                ? { icon: Image, titleKey: 'navigation.image' }
                : { icon: Video, titleKey: 'navigation.video' },
            ),
          },
          index: true,
        },
      ],
      // Topic URL sync plus the topic sidebar (opened as a drawer on mobile).
      element:
        kind === 'image'
          ? dynamicLayout(
              () => import('@/routes/(main)/(create)/image/_layout'),
              'Mobile > Image > Layout',
            )
          : dynamicLayout(
              () => import('@/routes/(main)/(create)/video/_layout'),
              'Mobile > Video > Layout',
            ),
    },
  ],
  element: pageLayout(`Mobile > ${kind} > Page Layout`),
  errorElement: <ErrorBoundary />,
  handle: { meta: routeMeta({ Skeleton: GenerationSkeleton }) },
  path: kind,
});

const dashboardRoute: RouteObject = {
  children: [
    {
      children: [
        {
          element: dynamicElement(() => import('@/routes/(main)/dashboard'), 'Mobile > Dashboards'),
          handle: { meta: dashboardsRouteMeta },
          index: true,
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/dashboard/[dashboardId]'),
            'Mobile > Dashboard Detail',
          ),
          handle: { meta: dashboardRouteMeta },
          path: ':dashboardId',
        },
      ],
      // Personal-only, and off unless the `dashboard` feature flag is on.
      element: dynamicLayout(
        () => import('@/routes/(main)/dashboard/_layout'),
        'Mobile > Dashboards > Gate',
      ),
    },
  ],
  element: pageLayout('Mobile > Dashboards > Page Layout'),
  errorElement: <ErrorBoundary resetPath=".." />,
  path: 'dashboard',
};

export const mobileWorkspaceRoutes: RouteObject[] = [
  taskWorkspaceRoute,
  ...projectRoutes,
  resourceRoute,
  memoryRoute,
  pageRoute,
  generationRoute('image'),
  generationRoute('video'),
  dashboardRoute,
];

/** Desktop-only surfaces (no mobile entry on desktop either) leave for home instead of being read as a workspace slug. */
export const mobileUnsupportedRoutes: RouteObject[] = [
  { element: redirectElement('..'), path: 'eval/*' },
];
