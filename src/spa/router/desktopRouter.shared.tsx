'use client';

import {
  BrainCircuit,
  Download,
  HomeIcon,
  Image,
  Scale,
  Settings,
  ShapesIcon,
  Video,
} from 'lucide-react';
import { createElement, type ReactElement } from 'react';
import type { RouteObject } from 'react-router';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
} from '@/business/client/BusinessDesktopRoutes';
import AppsSkeleton from '@/components/Skeleton/Apps';
import CommunityHomeSkeleton from '@/components/Skeleton/CommunityHome';
import CommunityListSkeleton from '@/components/Skeleton/CommunityList';
import AgentConversationLayoutSkeleton from '@/components/Skeleton/Conversation/AgentLayout';
import ConversationLayoutSkeleton from '@/components/Skeleton/Conversation/Layout';
import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import { delayed } from '@/components/Skeleton/Delayed';
import GenerationSkeleton from '@/components/Skeleton/Generation';
import MemorySkeleton from '@/components/Skeleton/Memory';
import ProviderSettingsSkeleton, {
  ProviderDetailSkeleton,
} from '@/components/Skeleton/Settings/Provider';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { agentDocumentRouteMeta } from '@/features/AgentDocumentPage/routeMeta';
import { goalDetailRouteMeta, goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { taskRouteMeta, tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { agentsRouteMeta } from '@/features/AgentViewAll/routeMeta';
import { dashboardRouteMeta, dashboardsRouteMeta } from '@/features/Dashboard/routeMeta';
import { pageRouteMeta } from '@/features/Pages/routeMeta';
import { projectsRouteMeta } from '@/features/Projects/routeMeta';
import ResourceCategorySkeleton from '@/features/ResourceHome/Skeleton';
import { createSettingsRouteMeta, settingsRouteMeta } from '@/features/Settings/features/routeMeta';
import { workspaceHomeRouteMeta } from '@/features/Workspace/routeMeta';
import WorkspaceProviderRedirect from '@/features/WorkspaceSetting/ProviderRedirect';
import {
  agentChannelDetailRouteMeta,
  agentChannelRouteMeta,
  agentChatDesktopRouteMeta,
  agentPermissionRouteMeta,
  agentProfileRouteMeta,
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
import AppShellSkeleton, { APP_SHELL_FALLBACK_ID } from '@/spa/BootShell/AppShellSkeleton';
import { loadRouteWithBuiltinToolSurfaces } from '@/spa/initialize/toolSurfaces';
import { activityListLoader } from '@/spa/router/activityListLoader';
import { agentChatTopicListLoader } from '@/spa/router/agentChatTopicListLoader';
import { agentDocumentListLoader } from '@/spa/router/agentDocumentListLoader';
import { channelDataLoader } from '@/spa/router/channelDataLoader';
import { identitiesListLoader } from '@/spa/router/identitiesListLoader';
import { pageListLoader } from '@/spa/router/pageListLoader';
import { preferenceListLoader } from '@/spa/router/preferenceListLoader';
import { projectWorkspaceRoute } from '@/spa/router/projectWorkspaceRoutes';
import { agentAccessLoader, agentGroupAccessLoader } from '@/spa/router/resourceAccessLoader';
import { resourceRoute } from '@/spa/router/resourceRoutes';
import { NoRouteSkeleton, routeMeta } from '@/spa/router/routeMeta';
import { scheduledTaskListLoader } from '@/spa/router/scheduledTaskListLoader';
import { taskWorkspaceChildren } from '@/spa/router/taskWorkspaceRoutes';
import { withSegmentFallback } from '@/spa/router/withSegmentFallback';
import { workspaceSettingsContentRoute } from '@/spa/router/workspaceSettingsRoutes';
import { SettingsTabs } from '@/store/global/initialState';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

export { ResourceCategorySkeleton };

const agentChatElement = dynamicElement(
  () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/(main)/agent')),
  'Desktop > Chat',
  { fallback: delayed(<ConversationSegmentSkeleton />), preloadId: 'agent' },
);

const groupChatElement = dynamicElement(
  () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/(main)/group')),
  'Desktop > Agent Group',
  { fallback: delayed(<ConversationLayoutSkeleton />), preloadId: 'group' },
);

export interface MainAreaRouteOptions {
  /** Electron renders Home inside each tab router; Web renders it beside the router outlet. */
  createHomeElement?: () => ReactElement;
  /** Electron keeps the workspace settings redirect behind its own lazy route module. */
  createWorkspaceSettingsIndexElement?: () => ReactElement;
}

const deferPlatformElement = (factory?: () => ReactElement) =>
  factory ? createElement(factory) : undefined;

/**
 * Children shared between the root tree (`/`) and the workspace tree
 * (`/:workspaceSlug`). Personal-only segments (settings, index, catch-all,
 * the workspace-slug block itself) are NOT included.
 *
 * Index redirects inside this list use **relative paths** so they resolve
 * correctly under both `/` (→ `/`) and `/:workspaceSlug` (→ `/:workspaceSlug`).
 */
export const sharedMainAreaChildren: RouteObject[] = [
  // Chat routes (agent)
  {
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
                element: agentChatElement,
                handle: { meta: agentChatDesktopRouteMeta },
                index: true,
                loader: agentChatTopicListLoader,
              },
              {
                element: agentChatElement,
                handle: { meta: agentChatDesktopRouteMeta },
                loader: agentChatTopicListLoader,
                path: ':topicId',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/agent/(chat)/_layout'),
              'Desktop > Chat > ChatLayout',
              { fallback: delayed(<AgentConversationLayoutSkeleton />), preloadId: 'agent' },
            ),
          },
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
            element: dynamicElement(
              () => import('@/routes/(main)/agent/goals'),
              'Desktop > Chat > Goals',
            ),
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
            element: dynamicElement(
              () => import('@/routes/(main)/agent/share'),
              'Desktop > Chat > Share',
            ),
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
                  () =>
                    import('@/routes/(main)/agent/self-learning/[domainId]/experience/[lessonId]'),
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
            element: dynamicElement(
              () => import('@/routes/(main)/agent/tasks'),
              'Desktop > Chat > Tasks',
            ),
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
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/agent/_layout'),
          'Desktop > Chat > Layout',
          { preloadId: 'agent' },
        ),
        errorElement: <ErrorBoundary />,
        // Seed the persisted access record before the config gates decide.
        loader: agentAccessLoader,
        path: ':aid',
      },
    ],
    path: 'agent',
  },

  // Group chat routes
  {
    children: [
      {
        element: redirectElement('..'),
        index: true,
      },
      {
        children: [
          {
            element: groupChatElement,
            handle: { meta: groupRouteMeta },
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/group/profile'),
              'Desktop > Agent Group > Profile',
            ),
            handle: { meta: groupProfileRouteMeta },
            path: 'profile',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/group/permission'),
              'Desktop > Agent Group > Permission',
            ),
            handle: { meta: groupPermissionRouteMeta },
            path: 'permission',
          },
          {
            element: groupChatElement,
            handle: { meta: groupRouteMeta },
            path: ':topicId',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/group/_layout'),
          'Desktop > Group > Layout',
          { preloadId: 'group' },
        ),
        errorElement: <ErrorBoundary />,
        loader: agentGroupAccessLoader,
        path: ':gid',
      },
    ],
    path: 'group',
  },

  // Discover routes with nested structure
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/community/(detail)/workspace/settings'),
          'Desktop > Discover > Workspace > Settings',
        ),
        handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
        path: 'workspace/settings',
      },
      // List routes (with ListLayout)
      {
        children: [
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/agent'),
                  'Desktop > Discover > List > Agent',
                ),
                handle: {
                  meta: routeMeta({
                    icon: ShapesIcon,
                    titleKey: 'navigation.discoverAssistants',
                  }),
                },
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/agent/_layout'),
              'Desktop > Discover > List > Agent > Layout',
            ),
            path: 'agent',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/model'),
                  'Desktop > Discover > List > Model',
                ),
                handle: {
                  meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discoverModels' }),
                },
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/model/_layout'),
              'Desktop > Discover > List > Model > Layout',
            ),
            path: 'model',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/provider'),
              'Desktop > Discover > List > Provider',
            ),
            handle: {
              meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discoverProviders' }),
            },
            path: 'provider',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/skill'),
                  'Desktop > Discover > List > Skill',
                ),
                handle: {
                  meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discover' }),
                },
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/skill/_layout'),
              'Desktop > Discover > List > Skill > Layout',
            ),
            path: 'skill',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/mcp'),
                  'Desktop > Discover > List > MCP',
                ),
                handle: {
                  meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discoverMcp' }),
                },
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/mcp/_layout'),
              'Desktop > Discover > List > MCP > Layout',
            ),
            path: 'mcp',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/workspace'),
              'Desktop > Discover > List > Workspace',
            ),
            handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('detail') }) },
            path: 'workspace',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/(home)'),
              'Desktop > Discover > List > Home',
              { preloadId: 'community' },
            ),
            handle: {
              meta: routeMeta({
                icon: ShapesIcon,
                Skeleton: CommunityHomeSkeleton,
                titleKey: 'navigation.discover',
              }),
            },
            index: true,
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/community/(list)/_layout'),
          'Desktop > Discover > List > Layout',
          { preloadId: 'community' },
        ),
        handle: { meta: routeMeta({ Skeleton: CommunityListSkeleton }) },
      },
      // Detail routes (with DetailLayout)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/agent'),
              'Desktop > Discover > Detail > Agent',
            ),
            path: 'agent/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/group_agent'),
              'Desktop > Discover > Detail > Group Agent',
            ),
            path: 'group_agent/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/model'),
              'Desktop > Discover > Detail > Model',
            ),
            path: 'model/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/provider'),
              'Desktop > Discover > Detail > Provider',
            ),
            path: 'provider/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/skill'),
              'Desktop > Discover > Detail > Skill',
            ),
            path: 'skill/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/mcp'),
              'Desktop > Discover > Detail > MCP',
            ),
            path: 'mcp/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/user'),
              'Desktop > Discover > Detail > User',
            ),
            path: 'user/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/organization'),
              'Desktop > Discover > Detail > Organization',
            ),
            path: 'org/:slug',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/community/(detail)/_layout'),
          'Desktop > Discover > Detail > Layout',
        ),
        handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('detail') }) },
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(main)/community/_layout'),
      'Desktop > Discover > Layout',
      { preloadId: 'community' },
    ),
    errorElement: <ErrorBoundary />,
    path: 'community',
  },

  resourceRoute,

  // Memory routes
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/(home)'),
          'Desktop > Memory > Home',
          { preloadId: 'memory' },
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
          'Desktop > Memory > Identities',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryIdentities' }),
        },
        // Seed the persisted identity list before the page paints, so a cold
        // start shows the local copy instead of a loading state.
        loader: identitiesListLoader,
        path: 'identities',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/contexts'),
          'Desktop > Memory > Contexts',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryContexts' }),
        },
        path: 'contexts',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/preferences'),
          'Desktop > Memory > Preferences',
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
          'Desktop > Memory > Rules',
        ),
        handle: {
          // Same icon the memory sidebar uses, so a desktop tab and the nav item agree.
          meta: routeMeta({ icon: Scale, titleKey: 'navigation.memoryRules' }),
        },
        path: 'rules',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/activities'),
          'Desktop > Memory > Activities',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
        },
        // Seed the persisted head page before the page paints (see `activityListLoader`).
        loader: activityListLoader,
        path: 'activities',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/memory/_layout'),
      'Desktop > Memory > Layout',
      { preloadId: 'memory' },
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
    path: 'memory',
  },

  // Video routes
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/(create)/video'), 'Desktop > Video', {
          preloadId: 'video',
        }),
        handle: {
          meta: routeMeta({ icon: Video, titleKey: 'navigation.video' }),
        },
        index: true,
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/(create)/video/_layout'),
      'Desktop > Video > Layout',
      { preloadId: 'video' },
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: routeMeta({ Skeleton: GenerationSkeleton }) },
    path: 'video',
  },

  // Image routes
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/(create)/image'), 'Desktop > Image', {
          preloadId: 'image',
        }),
        handle: {
          meta: routeMeta({ icon: Image, titleKey: 'navigation.image' }),
        },
        index: true,
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/(create)/image/_layout'),
      'Desktop > Image > Layout',
      { preloadId: 'image' },
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: routeMeta({ Skeleton: GenerationSkeleton }) },
    path: 'image',
  },

  ...BusinessDesktopRoutesWithMainLayout,

  // Eval routes
  {
    children: [
      // Home (overview)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/eval'),
              'Desktop > Eval > Overview',
              { preloadId: 'eval' },
            ),
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/eval/experiments/[experimentId]'),
              'Desktop > Eval > Experiment Detail',
            ),
            path: 'experiments/:experimentId',
          },
          // A dataset and a case are addressable on their own — a dataset need
          // not belong to a benchmark, so a benchmark id cannot be part of
          // their canonical path. They live in the home group to keep the eval
          // workspace sidebar; the bench group's sidebar is benchmark-scoped
          // and has nothing to show for a dataset that belongs to none.
          {
            element: dynamicElement(
              () => import('@/routes/(main)/eval/datasets/[datasetId]'),
              'Desktop > Eval > Dataset Detail',
            ),
            path: 'datasets/:datasetId',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/eval/cases/[caseId]'),
              'Desktop > Eval > Test Case Detail',
            ),
            path: 'cases/:caseId',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/eval/(home)/_layout'),
          'Desktop > Eval > Home > Layout',
          { preloadId: 'eval' },
        ),
      },
      // Bench routes (with dedicated sidebar)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/eval/bench/[benchmarkId]'),
              'Desktop > Eval > Benchmark Detail',
            ),
            handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('detail') }) },
            index: true,
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]'),
                  'Desktop > Eval > Run Detail',
                ),
                index: true,
              },
              {
                element: dynamicElement(
                  () =>
                    import('@/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]/cases/[caseId]'),
                  'Desktop > Eval > Case Detail',
                ),
                path: 'cases/:caseId',
              },
            ],
            path: 'runs/:runId',
          },
          {
            // Legacy shape, kept so existing links still resolve; it redirects
            // to the benchmark-free `/eval/datasets/:datasetId`.
            element: dynamicElement(
              () => import('@/routes/(main)/eval/bench/[benchmarkId]/datasets/[datasetId]'),
              'Desktop > Eval > Dataset Detail (legacy redirect)',
            ),
            path: 'datasets/:datasetId',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/eval/bench/[benchmarkId]/_layout'),
          'Desktop > Eval > Bench > Layout',
        ),
        path: 'bench/:benchmarkId',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(main)/eval/_layout'),
      'Desktop > Eval > Layout',
      { preloadId: 'eval' },
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
    path: 'eval',
  },

  // Agents view-all route (flat list of workspace/private agents)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/agents'), 'Desktop > Agents', {
          preloadId: 'agents',
        }),
        handle: { meta: agentsRouteMeta },
        index: true,
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'agents',
  },

  // Projects view-all route
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/projects'), 'Desktop > Projects', {
          preloadId: 'projects',
        }),
        handle: { meta: projectsRouteMeta },
        index: true,
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'projects',
  },

  // Personal dashboards (free-form monitoring boards)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/dashboard'), 'Desktop > Dashboards', {
          preloadId: 'dashboard',
        }),
        handle: { meta: dashboardsRouteMeta },
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/dashboard/[dashboardId]'),
          'Desktop > Dashboard Detail',
          { preloadId: 'dashboard' },
        ),
        handle: { meta: dashboardRouteMeta },
        path: ':dashboardId',
      },
    ],
    // Personal-only, and off unless the `dashboard` feature flag is on: the gate
    // leaves for home inside a workspace or while the flag is off.
    element: dynamicLayout(
      () => import('@/routes/(main)/dashboard/_layout'),
      'Desktop > Dashboards > Layout',
      {
        preloadId: 'dashboard',
      },
    ),
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'dashboard',
  },

  // Project workspace routes
  projectWorkspaceRoute,

  {
    children: taskWorkspaceChildren,
    element: dynamicLayout(
      () => import('@/routes/(main)/(task-workspace)/_layout'),
      'Desktop > Task Workspace > Layout',
      { preloadId: 'tasks' },
    ),
  },

  // Pages live in Docs: /page → /resource, /page/:id → /resource/page/:id.
  ...(['page', 'page/:id'] as const).map((path) => ({
    element: dynamicElement(
      () => import('@/routes/(main)/page/redirect'),
      `Desktop > Page > Redirect (${path})`,
    ),
    handle: { meta: pageRouteMeta },
    path,
  })),
  // The page permission screen keeps the Pages layout.
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/page/[id]/permission'),
          'Desktop > Page > Permission',
        ),
        handle: { meta: pageRouteMeta },
        path: ':id/permission',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/page/_layout'),
      'Desktop > Page > Layout',
      { preloadId: 'page' },
    ),
    errorElement: <ErrorBoundary />,
    loader: pageListLoader,
    path: 'page',
  },
];

const createMainAreaChildrenDefinition = (options: MainAreaRouteOptions = {}): RouteObject[] => [
  ...sharedMainAreaChildren,

  // Apps page (personal-only — never mirrored under /:workspaceSlug)
  {
    element: dynamicElement(() => import('@/routes/(main)/apps'), 'Desktop > Apps'),
    errorElement: <ErrorBoundary />,
    handle: {
      meta: routeMeta({ icon: Download, Skeleton: AppsSkeleton, titleKey: 'navigation.apps' }),
    },
    path: 'apps',
  },

  // Settings routes (personal-only — never mirrored under /:workspaceSlug)
  {
    children: [
      {
        element: redirectElement('/settings/profile'),
        index: true,
      },
      // Provider routes with nested structure
      {
        children: [
          {
            element: redirectElement('/settings/provider/all'),
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/settings/provider').then((m) => m.ProviderDetailPage),
              'Desktop > Settings > Provider > Detail',
              // Renders inside the provider layout, so only the detail body is pending.
              { fallback: delayed(<ProviderDetailSkeleton />) },
            ),
            handle: {
              meta: routeMeta({ icon: Settings, titleKey: 'navigation.provider' }),
            },
            path: ':providerId',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/settings/provider').then((m) => m.ProviderLayout),
          'Desktop > Settings > Provider > Layout',
        ),
        handle: {
          meta: routeMeta({
            icon: Settings,
            Skeleton: ProviderSettingsSkeleton,
            titleKey: 'navigation.provider',
          }),
        },
        path: 'provider',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/settings'),
          'Desktop > Settings > Memory',
        ),
        handle: { meta: settingsRouteMeta, settingsTab: SettingsTabs.Memory },
        path: 'memory',
      },
      {
        element: redirectElement('/settings/credential'),
        path: 'creds',
      },
      // Devices list and detail get their own page-shaped skeletons; the generic
      // `:tab` routes below would load them under the form-shaped settings one.
      {
        element: dynamicElement(
          () => import('@/routes/(main)/settings'),
          'Desktop > Settings > Devices',
        ),
        handle: {
          meta: createSettingsRouteMeta({
            Skeleton: createSurfaceSkeleton('grid'),
            tab: SettingsTabs.Devices,
          }),
          settingsTab: SettingsTabs.Devices,
        },
        path: 'devices',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/settings'),
          'Desktop > Settings > Devices > Detail',
        ),
        handle: {
          meta: createSettingsRouteMeta({
            Skeleton: createSurfaceSkeleton('detail'),
            tab: SettingsTabs.Devices,
          }),
          settingsTab: SettingsTabs.Devices,
        },
        path: 'devices/:sub',
      },
      // Other settings tabs
      {
        element: dynamicElement(
          () => import('@/routes/(main)/settings'),
          'Desktop > Settings > Tab',
        ),
        handle: { meta: settingsRouteMeta },
        path: ':tab',
      },
      // Tabs that need a sub-segment (e.g. /settings/messenger/discord) reuse
      // the same tab page; nested feature components read `:sub` via useParams.
      {
        element: dynamicElement(
          () => import('@/routes/(main)/settings'),
          'Desktop > Settings > Tab > Sub',
        ),
        handle: { meta: settingsRouteMeta },
        path: ':tab/:sub',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(main)/settings/_layout'),
      'Desktop > Settings > Layout',
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: settingsRouteMeta },
    path: 'settings',
  },

  // Workspace slug routes — `/:workspaceSlug/*` mirrors the shared main area.
  // Must come AFTER all reserved root paths so they don't shadow e.g. /agent.
  {
    children: [
      // Web renders Home beside the router outlet; Electron injects a per-tab
      // Home element because each tab owns an independent memory router.
      {
        element: deferPlatformElement(options.createHomeElement),
        handle: { meta: workspaceHomeRouteMeta },
        index: true,
      },
      ...sharedMainAreaChildren,
      // Workspace settings — `/:slug/settings/*`. Dedicated layout with its
      // own sidebar (workspace avatar + 6 tabs + back-to-chat), fully
      // decoupled from personal `/settings/*`.
      {
        children: [
          {
            element:
              deferPlatformElement(options.createWorkspaceSettingsIndexElement) ??
              redirectElement('general'),
            index: true,
          },
          // Full-bleed tabs render directly inside the workspace settings
          // shell (sidebar + outlet) — they own their internal layout.
          {
            element: dynamicElement(
              () => import('@/routes/(main)/[workspaceSlug]/settings/provider'),
              'Desktop > Workspace > Settings > Provider',
            ),
            handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
            path: 'provider',
          },
          // Path-shaped provider deep-links (`/:slug/settings/provider/:id`)
          // redirect to the query form the workspace provider page uses, so
          // they don't fall through to the catch-all and leave the workspace.
          // Static element: the redirect is tiny and lazy-loading it would
          // flash the generic brand loader before redirecting.
          {
            element: <WorkspaceProviderRedirect />,
            path: 'provider/:providerId',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/[workspaceSlug]/settings/skill'),
              'Desktop > Workspace > Settings > Skill',
              { preloadId: 'settings' },
            ),
            handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
            path: 'skill',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/[workspaceSlug]/settings/connector'),
              'Desktop > Workspace > Settings > Connector',
              { preloadId: 'settings' },
            ),
            handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
            path: 'connector',
          },
          workspaceSettingsContentRoute,
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/[workspaceSlug]/settings/_layout'),
          'Desktop > Workspace > Settings > Layout',
          { preloadId: 'settings' },
        ),
        errorElement: <ErrorBoundary />,
        path: 'settings',
      },
      // Legacy `/:slug/billing/*` URLs — redirect to the corresponding
      // `/:slug/settings/*` page. Kept for deep-links and bookmarks.
      {
        children: [
          { element: redirectElement('../settings/plans'), path: 'plans' },
          { element: redirectElement('../settings/usage'), path: 'usage' },
          { element: redirectElement('../settings/credits'), path: 'credits' },
          { element: redirectElement('../settings/billing'), path: 'billing' },
        ],
        path: 'billing',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/[workspaceSlug]/_layout'),
      'Desktop > Workspace > Layout',
    ),
    errorElement: <ErrorBoundary />,
    path: ':workspaceSlug',
  },

  // Web leaves this element empty; Electron injects the per-tab Home route.
  {
    element: deferPlatformElement(options.createHomeElement),
    handle: {
      meta: routeMeta({
        icon: HomeIcon,
        Skeleton: NoRouteSkeleton,
        tabTitleKey: 'navigation.home',
        titleKey: 'navigation.home',
      }),
    },
    index: true,
  },
  // Catch-all route
  {
    element: redirectElement('/'),
    path: '*',
  },
];

/**
 * Creates one stable lazy-element tree per runtime while returning a fresh
 * top-level array for every React Router instance. This prevents per-tab
 * router creation from registering duplicate preload loaders.
 */
export const createMainAreaRouteFactory = (options: MainAreaRouteOptions = {}) => {
  const routes = createMainAreaChildrenDefinition(options);

  return (): RouteObject[] => [...routes];
};

export interface SharedDesktopRouteOptions {
  mainAreaChildren: RouteObject[];
  onboardingRoute: RouteObject;
  /** Routes that intentionally exist on only one runtime, such as Web `/verify-im`. */
  platformRoutes?: RouteObject[];
}

/**
 * Builds the common Web/Electron top-level route tree. Platform entry files
 * supply only the root children, runtime-only routes, and onboarding route.
 */
export const createSharedDesktopRoutes = ({
  mainAreaChildren,
  onboardingRoute,
  platformRoutes = [],
}: SharedDesktopRouteOptions): RouteObject[] => [
  {
    children: withSegmentFallback(mainAreaChildren),
    // `BootShell` unmounts the moment the cache gate releases, which is often
    // before this chunk resolves. Falling back to the same skeleton keeps the
    // handoff invisible instead of flashing the brand logo a second time.
    element: dynamicLayout(() => import('@/routes/(main)/_layout'), 'Desktop > Main > Layout', {
      fallback: <AppShellSkeleton id={APP_SHELL_FALLBACK_ID} />,
    }),
    errorElement: <ErrorBoundary />,
    path: '/',
  },
  ...BusinessDesktopRoutesWithoutMainLayout,
  ...platformRoutes,
  onboardingRoute,
];
