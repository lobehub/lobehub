'use client';

import type { RouteObject } from 'react-router';

import { agentDocumentRouteMeta } from '@/features/AgentDocumentPage/routeMeta';
import { goalDetailRouteMeta, goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { mobileAgentSettingsRouteMeta } from '@/features/RouteMeta/mobileRouteMeta';
import {
  agentChannelDetailRouteMeta,
  agentChannelRouteMeta,
  agentPermissionRouteMeta,
  agentProfileRouteMeta,
  agentRouteMeta,
  agentSelfLearningRouteMeta,
  agentShareRouteMeta,
  agentStatisticsRouteMeta,
  topicsRouteMeta,
} from '@/routes/(main)/agent/features/routeMeta';
import {
  groupPermissionRouteMeta,
  groupProfileRouteMeta,
  groupRouteMeta,
} from '@/routes/(main)/group/features/routeMeta';
import { loadRouteWithBuiltinToolSurfaces } from '@/spa/initialize/toolSurfaces';
import { agentChatTopicListLoader } from '@/spa/router/agentChatTopicListLoader';
import { agentDocumentListLoader } from '@/spa/router/agentDocumentListLoader';
import { channelDataLoader } from '@/spa/router/channelDataLoader';
import { agentAccessLoader, agentGroupAccessLoader } from '@/spa/router/resourceAccessLoader';
import { NoRouteSkeleton, routeMeta } from '@/spa/router/routeMeta';
import { scheduledTaskListLoader } from '@/spa/router/scheduledTaskListLoader';
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
const agentSubPages: RouteObject[] = [
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/docs'),
          'Mobile > Agent > DocumentsIndex',
        ),
        // The empty state renders no header; the shell adds back + the docs drawer.
        handle: {
          meta: routeMeta({ Skeleton: NoRouteSkeleton, titleKey: 'navigation.document' }),
          mobileShellHeader: true,
        },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/docs/[docId]'),
          'Mobile > Agent > Document',
        ),
        handle: { meta: agentDocumentRouteMeta },
        path: ':docId',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/agent/docs/_layout'),
      'Mobile > Agent > DocumentLayout',
    ),
    loader: agentDocumentListLoader,
    path: 'docs',
  },
  {
    element: dynamicElement(() => import('@/routes/(main)/agent/goals'), 'Mobile > Agent > Goals'),
    handle: { meta: goalsRouteMeta },
    path: 'goals',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/goal/[goalId]'),
      'Mobile > Agent > Goal Detail',
    ),
    handle: { meta: goalDetailRouteMeta },
    path: 'goal/:goalId',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/profile'),
      'Mobile > Agent > Profile',
    ),
    handle: { meta: agentProfileRouteMeta },
    path: 'profile',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/channel'),
      'Mobile > Agent > Channel',
    ),
    handle: { meta: agentChannelRouteMeta },
    loader: channelDataLoader,
    path: 'channel',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/channel/[platform]'),
      'Mobile > Agent > Channel Platform',
    ),
    handle: { meta: agentChannelDetailRouteMeta },
    loader: channelDataLoader,
    path: 'channel/:platform',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/topics'),
      'Mobile > Agent > Topics',
    ),
    handle: { meta: topicsRouteMeta },
    path: 'topics',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/statistics'),
      'Mobile > Agent > Statistics',
    ),
    handle: { meta: agentStatisticsRouteMeta },
    path: 'statistics',
  },
  {
    element: dynamicElement(() => import('@/routes/(main)/agent/share'), 'Mobile > Agent > Share'),
    handle: { meta: agentShareRouteMeta },
    path: 'share',
  },
  // Legacy `/agent/:aid/stats` URLs — kept for deep-links.
  { element: redirectElement('../statistics'), path: 'stats' },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/self-learning'),
      'Mobile > Agent > Self Learning',
    ),
    handle: { meta: agentSelfLearningRouteMeta },
    path: 'self-evolving',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/self-learning/new'),
      'Mobile > Agent > Self Learning > Create',
    ),
    handle: { meta: agentSelfLearningRouteMeta },
    path: 'self-evolving/new',
  },
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/self-learning/[domainId]'),
          'Mobile > Agent > Self Learning > Domain',
        ),
        handle: { meta: agentSelfLearningRouteMeta },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/self-learning/[domainId]/experience'),
          'Mobile > Agent > Self Learning > Domain > Experience',
        ),
        handle: { meta: agentSelfLearningRouteMeta },
        path: 'experience',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/self-learning/[domainId]/experience/[lessonId]'),
          'Mobile > Agent > Self Learning > Domain > Lesson',
        ),
        handle: { meta: agentSelfLearningRouteMeta },
        path: 'experience/:lessonId',
      },
      { element: redirectElement('../experience'), path: 'rules' },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/self-learning/[domainId]/rules/[lessonId]'),
          'Mobile > Agent > Self Learning > Domain > Legacy Rule',
        ),
        handle: { meta: routeMeta({ Skeleton: NoRouteSkeleton }) },
        path: 'rules/:lessonId',
      },
    ],
    path: 'self-evolving/:domainId',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/self-learning/legacy'),
      'Mobile > Agent > Legacy Self Learning Redirect',
    ),
    handle: { meta: routeMeta({ Skeleton: NoRouteSkeleton }) },
    path: 'self-learning/*',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/permission'),
      'Mobile > Agent > Permission',
    ),
    handle: { meta: agentPermissionRouteMeta },
    path: 'permission',
  },
  {
    element: dynamicElement(() => import('@/routes/(main)/agent/tasks'), 'Mobile > Agent > Tasks'),
    handle: { meta: tasksRouteMeta },
    loader: scheduledTaskListLoader,
    path: 'tasks',
  },
];

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
        {
          children: agentSubPages,
          element: dynamicLayout(
            () => import('@/routes/(mobile)/_page-layout'),
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
            () => import('@/routes/(mobile)/_page-layout'),
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
