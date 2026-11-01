import type { RouteObject } from 'react-router';

import { agentDocumentRouteMeta } from '@/features/AgentDocumentPage/routeMeta';
import { goalDetailRouteMeta, goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { taskRouteMeta, tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import {
  agentChannelDetailRouteMeta,
  agentChannelRouteMeta,
  agentPermissionRouteMeta,
  agentProfileRouteMeta,
  agentSelfLearningRouteMeta,
  agentShareRouteMeta,
  agentStatisticsRouteMeta,
  topicsRouteMeta,
} from '@/routes/(main)/agent/features/routeMeta';
import { agentDocumentListLoader } from '@/spa/router/agentDocumentListLoader';
import { channelDataLoader } from '@/spa/router/channelDataLoader';
import { NoRouteSkeleton, routeMeta } from '@/spa/router/routeMeta';
import { scheduledTaskListLoader } from '@/spa/router/scheduledTaskListLoader';
import { dynamicElement, dynamicLayout, redirectElement } from '@/utils/router';

/**
 * The full-page agent surfaces under `/agent/:aid` beside the chat: docs,
 * goals, profile, channels, topics, statistics, share, self-evolving,
 * permission and tasks. Mounted by the desktop router under the agent layout
 * and reused by the mobile router (`mobileAgentRoutes.tsx`).
 */
export const agentPageChildren: RouteObject[] = [
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/docs'),
          'Desktop > Chat > DocumentsIndex',
        ),
        handle: { meta: routeMeta({ Skeleton: NoRouteSkeleton }) },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/docs/[docId]'),
          'Desktop > Chat > Document',
        ),
        handle: { meta: agentDocumentRouteMeta },
        path: ':docId',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/agent/docs/_layout'),
      'Desktop > Chat > DocumentLayout',
    ),
    // Seed the persisted document list before the docs sidebar paints.
    loader: agentDocumentListLoader,
    path: 'docs',
  },
  {
    element: dynamicElement(() => import('@/routes/(main)/agent/goals'), 'Desktop > Chat > Goals'),
    handle: { meta: goalsRouteMeta },
    path: 'goals',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/goal/[goalId]'),
      'Desktop > Chat > Goal Detail',
    ),
    handle: { meta: goalDetailRouteMeta },
    path: 'goal/:goalId',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/profile'),
      'Desktop > Chat > Profile',
    ),
    handle: { meta: agentProfileRouteMeta },
    path: 'profile',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/channel'),
      'Desktop > Chat > Channel',
    ),
    handle: { meta: agentChannelRouteMeta },
    loader: channelDataLoader,
    path: 'channel',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/channel/[platform]'),
      'Desktop > Chat > Channel Platform',
    ),
    handle: { meta: agentChannelDetailRouteMeta },
    loader: channelDataLoader,
    path: 'channel/:platform',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/topics'),
      'Desktop > Chat > Topics',
    ),
    handle: { meta: topicsRouteMeta },
    path: 'topics',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/statistics'),
      'Desktop > Chat > Statistics',
    ),
    handle: { meta: agentStatisticsRouteMeta },
    path: 'statistics',
  },
  {
    element: dynamicElement(() => import('@/routes/(main)/agent/share'), 'Desktop > Chat > Share'),
    handle: { meta: agentShareRouteMeta },
    path: 'share',
  },
  // Legacy `/agent/:aid/stats` URLs — kept for deep-links.
  {
    element: redirectElement('../statistics'),
    path: 'stats',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/self-learning'),
      'Desktop > Chat > Self Learning',
    ),
    handle: { meta: agentSelfLearningRouteMeta },
    path: 'self-evolving',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/self-learning/new'),
      'Desktop > Chat > Self Learning > Create',
    ),
    handle: { meta: agentSelfLearningRouteMeta },
    path: 'self-evolving/new',
  },
  // 单个方向的成长画像。做成路由而不是页内状态，深链才打得开。
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/self-learning/[domainId]'),
          'Desktop > Chat > Self Learning > Domain',
        ),
        handle: { meta: agentSelfLearningRouteMeta },
        index: true,
      },
      // 一个方向的全部经验（不折叠的完整清单）和单条经验详情。
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/self-learning/[domainId]/experience'),
          'Desktop > Chat > Self Learning > Domain > Experience',
        ),
        handle: { meta: agentSelfLearningRouteMeta },
        path: 'experience',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/self-learning/[domainId]/experience/[lessonId]'),
          'Desktop > Chat > Self Learning > Domain > Lesson',
        ),
        handle: { meta: agentSelfLearningRouteMeta },
        path: 'experience/:lessonId',
      },
      // Legacy `/rules` deep-links — kept so old links keep opening.
      {
        element: redirectElement('../experience'),
        path: 'rules',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/agent/self-learning/[domainId]/rules/[lessonId]'),
          'Desktop > Chat > Self Learning > Domain > Legacy Rule',
        ),
        handle: { meta: routeMeta({ Skeleton: NoRouteSkeleton }) },
        path: 'rules/:lessonId',
      },
    ],
    path: 'self-evolving/:domainId',
  },
  // Legacy `/self-learning` deep-links keep their remaining path when redirected.
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/self-learning/legacy'),
      'Desktop > Chat > Legacy Self Learning Redirect',
    ),
    handle: { meta: routeMeta({ Skeleton: NoRouteSkeleton }) },
    path: 'self-learning/*',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/permission'),
      'Desktop > Chat > Permission',
    ),
    handle: { meta: agentPermissionRouteMeta },
    path: 'permission',
  },
  {
    element: dynamicElement(() => import('@/routes/(main)/agent/tasks'), 'Desktop > Chat > Tasks'),
    handle: { meta: tasksRouteMeta },
    loader: scheduledTaskListLoader,
    path: 'tasks',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/agent/task/[taskId]'),
      'Desktop > Chat > Task Detail',
    ),
    handle: { meta: taskRouteMeta },
    // `:slug?` is the readable title tail (Linear-style). It is never
    // resolved against — `:taskId` alone identifies the task — so the
    // optional segment keeps every pre-slug link working.
    path: 'task/:taskId/:slug?',
  },
];
