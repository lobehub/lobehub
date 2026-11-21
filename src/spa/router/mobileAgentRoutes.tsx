'use client';

import type { RouteObject } from 'react-router';

import { mobileAgentSettingsRouteMeta } from '@/features/RouteMeta/mobileRouteMeta';
import { agentRouteMeta } from '@/routes/(main)/agent/features/routeMeta';
import {
  groupPermissionRouteMeta,
  groupProfileRouteMeta,
  groupRouteMeta,
} from '@/routes/(main)/group/features/routeMeta';
import { loadRouteWithBuiltinToolSurfaces } from '@/spa/initialize/toolSurfaces';
import { agentChatTopicListLoader } from '@/spa/router/agentChatTopicListLoader';
import { agentPageChildren } from '@/spa/router/agentPageRoutes';
import { agentAccessLoader, agentGroupAccessLoader } from '@/spa/router/resourceAccessLoader';
import { NoRouteSkeleton, routeMeta } from '@/spa/router/routeMeta';
import { dropRoute, overlayRoutes } from '@/spa/router/routeOverlay';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

const mobileChatElement = dynamicElement(
  () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/(mobile)/chat')),
  'Mobile > Chat',
  { preloadId: 'mobile-agent' },
);

const mobileGroupChatElement = (name: string) =>
  dynamicElement(
    () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/(mobile)/group')),
    name,
    { preloadId: 'mobile-group' },
  );

/**
 * Desktop agent pages mounted full-screen on mobile. Each renders its own
 * `NavHeader`, which carries the mobile back button and the agent sidebar
 * drawer. Static paths outrank the chat's `:topicId`, so these stop opening the
 * chat with the page name as a topic id.
 */
const agentSubPages = overlayRoutes(agentPageChildren, {
  // The empty state renders no header; the shell adds back + the docs drawer.
  'docs/index': (route) => ({
    ...route,
    handle: {
      meta: routeMeta({ Skeleton: NoRouteSkeleton, titleKey: 'navigation.document' }),
      mobileShellHeader: true,
    },
  }),
  // Served from the task workspace (`mobileWorkspaceRoutes.tsx`) on mobile.
  'task/:taskId/:slug?': dropRoute,
});

export const mobileAgentRoute: RouteObject = {
  children: [
    {
      element: redirectElement('..'),
      index: true,
    },
    {
      children: [
        {
          children: [
            {
              element: mobileChatElement,
              handle: { meta: agentRouteMeta },
              index: true,
              loader: agentChatTopicListLoader,
            },
            {
              element: mobileChatElement,
              handle: { meta: agentRouteMeta },
              loader: agentChatTopicListLoader,
              path: ':topicId',
            },
          ],
          element: dynamicLayout(
            () => import('@/routes/(mobile)/chat/_layout'),
            'Mobile > Chat > Layout',
            { preloadId: 'mobile-agent' },
          ),
        },
        {
          children: [
            // Settings brings its own header, so it sits beside the chat layout
            // instead of stacking under the chat header.
            {
              element: dynamicElement(
                () => import('@/routes/(mobile)/chat/settings'),
                'Mobile > Chat > Settings',
              ),
              handle: { meta: mobileAgentSettingsRouteMeta },
              path: 'settings',
            },
            ...agentSubPages,
          ],
          element: dynamicLayout(
            () => import('@/routes/(mobile)/agent/_pages'),
            'Mobile > Agent > Page Layout',
          ),
        },
      ],
      element: dynamicLayout(
        () => import('@/routes/(mobile)/agent/_layout'),
        'Mobile > Agent > Layout',
        { preloadId: 'mobile-agent' },
      ),
      errorElement: <ErrorBoundary />,
      // Seed the persisted access record before the config gates decide.
      loader: agentAccessLoader,
      path: ':aid',
    },
  ],
  path: 'agent',
};

export const mobileGroupRoute: RouteObject = {
  children: [
    { element: redirectElement('..'), index: true },
    {
      children: [
        {
          children: [
            { element: mobileGroupChatElement('Mobile > Group'), index: true },
            { element: mobileGroupChatElement('Mobile > Group > Topic'), path: ':topicId' },
          ],
          element: dynamicLayout(
            () => import('@/routes/(mobile)/group/_layout'),
            'Mobile > Group > Layout',
            { preloadId: 'mobile-group' },
          ),
        },
        {
          children: [
            {
              element: dynamicElement(
                () => import('@/routes/(main)/group/profile'),
                'Mobile > Group > Profile',
              ),
              handle: { meta: groupProfileRouteMeta },
              path: 'profile',
            },
            {
              element: dynamicElement(
                () => import('@/routes/(main)/group/permission'),
                'Mobile > Group > Permission',
              ),
              handle: { meta: groupPermissionRouteMeta },
              path: 'permission',
            },
          ],
          element: dynamicLayout(
            () => import('@/routes/(mobile)/group/_pages'),
            'Mobile > Group > Page Layout',
          ),
        },
      ],
      element: dynamicLayout(
        () => import('@/routes/(mobile)/group/_scope'),
        'Mobile > Group > Scope',
        { preloadId: 'mobile-group' },
      ),
      errorElement: <ErrorBoundary />,
      handle: { meta: groupRouteMeta },
      loader: agentGroupAccessLoader,
      path: ':gid',
    },
  ],
  path: 'group',
};
