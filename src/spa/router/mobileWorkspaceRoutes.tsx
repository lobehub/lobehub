'use client';

import { FilePenIcon, Image, Video } from 'lucide-react';
import { lazy } from 'react';
import type { RouteObject } from 'react-router';

import GenerationSkeleton from '@/components/Skeleton/Generation';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { taskRouteMeta } from '@/features/AgentTasks/routeMeta';
import { dashboardRouteMeta, dashboardsRouteMeta } from '@/features/Dashboard/routeMeta';
import { pageRouteMeta } from '@/features/Pages/routeMeta';
import { projectsRouteMeta } from '@/features/Projects/routeMeta';
import { memoryChildren } from '@/spa/router/memoryRoutes';
import { pageListLoader } from '@/spa/router/pageListLoader';
import { projectWorkspaceRoute } from '@/spa/router/projectWorkspaceRoutes';
import { resourceRoute as desktopResourceRoute } from '@/spa/router/resourceRoutes';
import { routeMeta } from '@/spa/router/routeMeta';
import { overlayRoutes, withHandle } from '@/spa/router/routeOverlay';
import { createTaskWorkspaceChildren } from '@/spa/router/taskWorkspaceRoutes';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

/**
 * The desktop workspace surfaces (tasks, goals, projects, resources, memory,
 * pages, generation, dashboards) mounted on mobile. Every page reuses its
 * desktop segment; desktop layouts that only paint a sidebar are kept because
 * the sidebar they register opens from the mobile page header as a drawer.
 * Mounted under both `/` and `/:workspaceSlug` by `mobileRouter.config.tsx`.
 */

// Reads the project store, so keep it out of the router's entry graph.
const ProjectMobileShellTitle = lazy(() => import('@/features/Projects/MobileShellTitle'));

const pageLayout = (name: string) =>
  dynamicLayout(() => import('@/routes/(mobile)/_page-layout'), name);

const taskWorkspaceRoute: RouteObject = {
  children: [
    ...createTaskWorkspaceChildren({ label: 'Mobile', preloadId: 'mobile-tasks' }),
    // Desktop serves this under the agent layout; mobile keeps it in the task
    // workspace so the task detail gets the workspace's task sidebar drawer.
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
  // The desktop project workspace (home, topics, tasks, settings, goals,
  // dashboards, acceptance) inside the mobile page layout. Its layout gates on
  // `enableProjects`, loads the project and registers the project sidebar,
  // which mobile opens as a drawer.
  {
    children: [
      {
        ...projectWorkspaceRoute,
        children: overlayRoutes(projectWorkspaceRoute.children ?? [], {
          'index': withHandle({
            mobileShellHeader: true,
            mobileShellTitle: ProjectMobileShellTitle,
          }),
          // The settings page opens with its own "Project settings" heading.
          'settings/:section?': withHandle({ mobileShellHeader: 'untitled' }),
          'topic/:topicId?': (route) => ({
            ...route,
            element: dynamicElement(
              () => import('@/routes/(mobile)/project/[projectId]/topic'),
              'Mobile > Project Topic',
            ),
          }),
        }),
        errorElement: undefined,
        path: undefined,
      } as RouteObject,
    ],
    element: pageLayout('Mobile > Project > Page Layout'),
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'project/:projectId',
  },
];

// The shared Docs subtree (home, drive, works, library gallery, libraries)
// wrapped in the mobile page layout with the drag context its rows need. Reused
// rather than copied, so the mobile tree follows every desktop route change.
// Works paints no page header, so the shell adds one there.
const resourceRoute: RouteObject = {
  children: overlayRoutes([{ ...desktopResourceRoute, path: undefined }], {
    works: withHandle({ mobileShellHeader: true }),
  }),
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
      // The contexts page (entity list + page) paints no header of its own.
      children: overlayRoutes(memoryChildren, {
        contexts: withHandle({ mobileShellHeader: true }),
      }),
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
  // Multi-agent Channels currently use the desktop home sidebar and conversation layout.
  { element: redirectElement('..'), path: 'channels/*' },
  { element: redirectElement('..'), path: 'eval/*' },
];
