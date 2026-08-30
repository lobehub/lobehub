'use client';

import {
  BrainCircuit,
  Download,
  FilePenIcon,
  FilesIcon,
  FileText,
  HomeIcon,
  Image,
  ImageIcon,
  LayoutPanelTopIcon,
  LibraryBigIcon,
  Mic2,
  Settings,
  ShapesIcon,
  SquarePlay,
} from 'lucide-react';
import { createElement, isValidElement, type ReactElement, type ReactNode, Suspense } from 'react';
import type { RouteObject } from 'react-router';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
  BusinessResourceRoutes,
} from '@/business/client/BusinessDesktopRoutes';
import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import AppsSkeleton from '@/components/Skeleton/Apps';
import ConversationLayoutSkeleton from '@/components/Skeleton/Conversation/Layout';
import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import GenerationSkeleton from '@/components/Skeleton/Generation';
import HomeSkeleton from '@/components/Skeleton/Home';
import MemorySkeleton from '@/components/Skeleton/Memory';
import RouteSegmentSkeleton from '@/components/Skeleton/RouteSegment';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { agentDocumentRouteMeta } from '@/features/AgentDocumentPage/routeMeta';
import { goalDetailRouteMeta, goalsRouteMeta } from '@/features/AgentGoals/routeMeta';
import { taskRouteMeta, tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { agentsRouteMeta } from '@/features/AgentViewAll/routeMeta';
import { pageRouteMeta } from '@/features/Pages/routeMeta';
import { projectsRouteMeta } from '@/features/Projects/routeMeta';
import { settingsRouteMeta } from '@/features/Settings/features/routeMeta';
import { workspaceHomeRouteMeta } from '@/features/Workspace/routeMeta';
import WorkspaceProviderRedirect from '@/features/WorkspaceSetting/ProviderRedirect';
import {
  agentChannelRouteMeta,
  agentPermissionRouteMeta,
  agentProfileRouteMeta,
  agentRouteMeta,
  agentSelfLearningRouteMeta,
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
import { routeMeta } from '@/spa/router/routeMeta';
import { SettingsTabs } from '@/store/global/initialState';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

const agentChatElement = dynamicElement(
  () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/(main)/agent')),
  'Desktop > Chat',
  { fallback: <ConversationSegmentSkeleton />, preloadId: 'agent' },
);

const groupChatElement = dynamicElement(
  () => loadRouteWithBuiltinToolSurfaces(() => import('@/routes/(main)/group')),
  'Desktop > Agent Group',
  { fallback: <ConversationLayoutSkeleton />, preloadId: 'group' },
);

const resourceCategoryRoutes: RouteObject[] = [
  { icon: LayoutPanelTopIcon, path: 'all', titleKey: 'navigation.resourceAll' },
  { icon: FileText, path: 'documents', titleKey: 'navigation.resourceDocuments' },
  { icon: ImageIcon, path: 'images', titleKey: 'navigation.resourceImages' },
  { icon: SquarePlay, path: 'videos', titleKey: 'navigation.resourceVideos' },
  { icon: Mic2, path: 'audios', titleKey: 'navigation.resourceAudios' },
  { icon: FilesIcon, path: 'files', titleKey: 'navigation.resourceFiles' },
].map(({ icon, path, titleKey }) => ({
  element: dynamicElement(
    () => import('@/routes/(main)/resource/(home)'),
    `Desktop > Resource > Home > ${path}`,
    { preloadId: 'resource' },
  ),
  handle: { meta: routeMeta({ icon, titleKey }) },
  path,
}));

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
                handle: { meta: agentRouteMeta },
                index: true,
              },
              {
                element: agentChatElement,
                handle: { meta: agentRouteMeta },
                path: ':topicId',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/agent/(chat)/_layout'),
              'Desktop > Chat > ChatLayout',
              { fallback: <ConversationLayoutSkeleton />, preloadId: 'agent' },
            ),
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/agent/docs'),
                  'Desktop > Chat > DocumentsIndex',
                ),
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
            path: 'channel',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/channel/[platform]'),
              'Desktop > Chat > Channel Platform',
            ),
            handle: { meta: agentChannelRouteMeta },
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
            path: 'tasks',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/agent/task/[taskId]'),
              'Desktop > Chat > Task Detail',
            ),
            handle: { meta: taskRouteMeta },
            path: 'task/:taskId',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/agent/_layout'),
          'Desktop > Chat > Layout',
          { preloadId: 'agent' },
        ),
        errorElement: <ErrorBoundary />,
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
            path: 'workspace',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/(home)'),
              'Desktop > Discover > List > Home',
              { preloadId: 'community' },
            ),
            handle: {
              meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discover' }),
            },
            index: true,
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/community/(list)/_layout'),
          'Desktop > Discover > List > Layout',
          { preloadId: 'community' },
        ),
        handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('grid') }) },
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

  // Resource routes
  {
    children: [
      // Home routes (resource list)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/(home)'),
              'Desktop > Resource > Home',
              { preloadId: 'resource' },
            ),
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.resources' }),
            },
            index: true,
          },
          ...BusinessResourceRoutes,
          ...resourceCategoryRoutes,
          // /resource/page needs a static segment: the dynamic `:category`
          // ties with the workspace mirror `/:workspaceSlug/page` on route
          // score, and the workspace tree would swallow it into a slug 404.
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/(home)'),
              'Desktop > Resource > Home > Pages',
              { preloadId: 'resource' },
            ),
            handle: {
              meta: routeMeta({ icon: FilePenIcon, titleKey: 'navigation.resourcePages' }),
            },
            path: 'page',
          },
          // Category views share the home page: /resource/documents, /resource/images, …
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/(home)'),
              'Desktop > Resource > Home > Category',
              { preloadId: 'resource' },
            ),
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.resources' }),
            },
            path: ':category',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/resource/(home)/_layout'),
          'Desktop > Resource > Home > Layout',
          { preloadId: 'resource' },
        ),
      },
      // Library routes (knowledge base detail)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/library'),
              'Desktop > Resource > Library',
            ),
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
            },
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/library/permission'),
              'Desktop > Resource > Library > Permission',
            ),
            handle: {
              meta: routeMeta({
                icon: LibraryBigIcon,
                Skeleton: createSurfaceSkeleton('form'),
                titleKey: 'navigation.knowledgeBase',
              }),
            },
            path: 'permission',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/resource/library/[slug]'),
              'Desktop > Resource > Library > Slug',
            ),
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
            },
            path: ':slug',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/resource/library/_layout'),
          'Desktop > Resource > Library > Layout',
        ),
        path: 'library/:id',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(main)/resource/_layout'),
      'Desktop > Resource > Layout',
      { preloadId: 'resource' },
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
    path: 'resource',
  },

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
        path: 'preferences',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/experiences'),
          'Desktop > Memory > Experiences',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryExperiences' }),
        },
        path: 'experiences',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/memory/activities'),
          'Desktop > Memory > Activities',
        ),
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
        },
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
            element: dynamicElement(
              () => import('@/routes/(main)/eval/bench/[benchmarkId]/datasets/[datasetId]'),
              'Desktop > Eval > Dataset Detail',
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

  // Task workspace routes (cross-agent)
  {
    children: [
      {
        element: redirectElement('tasks'),
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/project/[projectId]/tasks'),
          'Desktop > Project Tasks',
        ),
        handle: { meta: tasksRouteMeta },
        path: 'tasks',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/project/[projectId]/goals'),
          'Desktop > Project Goals',
        ),
        handle: { meta: goalsRouteMeta },
        path: 'goals',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/project/_layout'),
      'Desktop > Project Workspace > Layout',
      { preloadId: 'project' },
    ),
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'project/:projectId',
  },

  {
    children: [
      {
        children: [
          {
            element: dynamicElement(() => import('@/routes/(main)/tasks'), 'Desktop > Tasks', {
              preloadId: 'tasks',
            }),
            handle: { meta: tasksRouteMeta },
            index: true,
          },
        ],
        errorElement: <ErrorBoundary resetPath=".." />,
        path: 'tasks',
      },
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/task/[taskId]'),
              'Desktop > Task Detail',
            ),
            handle: { meta: taskRouteMeta },
            path: ':taskId',
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
              'Desktop > Goal Detail',
            ),
            handle: { meta: goalDetailRouteMeta },
            path: ':goalId',
          },
        ],
        errorElement: <ErrorBoundary resetPath="../tasks" />,
        path: 'goal',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/(task-workspace)/_layout'),
      'Desktop > Task Workspace > Layout',
      { preloadId: 'tasks' },
    ),
  },

  // Pages routes
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/page'), 'Desktop > Page', {
          preloadId: 'page',
        }),
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
        element: dynamicElement(
          () => import('@/routes/(main)/page/[id]'),
          'Desktop > Page > Detail',
        ),
        handle: { meta: pageRouteMeta },
        path: ':id',
      },
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
          meta: routeMeta({ icon: Settings, titleKey: 'navigation.provider' }),
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
            path: 'skill',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/[workspaceSlug]/settings/connector'),
              'Desktop > Workspace > Settings > Connector',
              { preloadId: 'settings' },
            ),
            path: 'connector',
          },
          // Padded tabs share a centered, max-width container layout.
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/general'),
                  'Desktop > Workspace > Settings > General',
                ),
                path: 'general',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/members'),
                  'Desktop > Workspace > Settings > Members',
                ),
                path: 'members',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/notification'),
                  'Desktop > Workspace > Settings > Notification',
                ),
                path: 'notification',
              },
              // Channel detail level of the two-level notification settings —
              // the page reads the channel id from the `sub` route param.
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/notification'),
                  'Desktop > Workspace > Settings > Notification > Channel',
                ),
                path: 'notification/:sub',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/statistics'),
                  'Desktop > Workspace > Settings > Statistics',
                ),
                path: 'statistics',
              },
              // Legacy `/:slug/settings/stats` URLs — kept for deep-links.
              {
                element: redirectElement('../statistics'),
                path: 'stats',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/plans'),
                  'Desktop > Workspace > Settings > Plans',
                ),
                path: 'plans',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/billing'),
                  'Desktop > Workspace > Settings > Billing',
                ),
                path: 'billing',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/budget'),
                  'Desktop > Workspace > Settings > Budget',
                ),
                path: 'budget',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/credits'),
                  'Desktop > Workspace > Settings > Credits',
                ),
                path: 'credits',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/usage'),
                  'Desktop > Workspace > Settings > Usage',
                ),
                path: 'usage',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/service-model'),
                  'Desktop > Workspace > Settings > Service Model',
                ),
                path: 'service-model',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/credential'),
                  'Desktop > Workspace > Settings > Credential',
                ),
                path: 'credential',
              },
              // Legacy `/:slug/settings/creds` URLs — kept for deep-links.
              {
                element: redirectElement('../credential'),
                path: 'creds',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/apikey'),
                  'Desktop > Workspace > Settings > API Key',
                ),
                path: 'apikey',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/oauth-apps'),
                  'Desktop > Workspace > Settings > OAuth Apps',
                ),
                path: 'oauth-apps',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/oauth-apps'),
                  'Desktop > Workspace > Settings > OAuth App Detail',
                ),
                path: 'oauth-apps/:sub',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/audit-log'),
                  'Desktop > Workspace > Settings > Audit Log',
                ),
                path: 'audit-log',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/labels'),
                  'Desktop > Workspace > Settings > Labels',
                ),
                path: 'labels',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/storage'),
                  'Desktop > Workspace > Settings > Storage',
                ),
                path: 'storage',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/devices'),
                  'Desktop > Workspace > Settings > Devices',
                ),
                path: 'devices',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/[workspaceSlug]/settings/_content-layout'),
              'Desktop > Workspace > Settings > Content Layout',
              { preloadId: 'settings' },
            ),
          },
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
        Skeleton: HomeSkeleton,
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
/**
 * Swap the default brand-loading fallback for a structural segment skeleton.
 *
 * `dynamicElement` / `dynamicLayout` wrap every route element in their own
 * `Suspense`, and that boundary is always nearer the suspending component than
 * any outlet-level one — so a fallback set on the main layout's outlet never
 * fires for route content, and the 100+ call sites would otherwise each need
 * the option. Explicit route fallbacks are preserved so a route can render the
 * nearest segment skeleton instead. Rewriting only defaults here keeps the main
 * area consistent without touching routes outside it (mobile still wants the
 * full-page brand loading, since its nav bar is inside the same boundary as its
 * outlet).
 */
export const withSegmentFallback = (routes: RouteObject[]): RouteObject[] =>
  routes.map((route) => {
    const suspenseElement =
      isValidElement(route.element) && route.element.type === Suspense
        ? (route.element as ReactElement<{ fallback: ReactNode }>)
        : undefined;
    const fallback = suspenseElement?.props.fallback;
    const element =
      suspenseElement && isValidElement(fallback) && fallback.type === BrandTextLoading
        ? // This intentionally couples to `dynamicElement` / `dynamicLayout`
          // returning a bare Suspense with BrandTextLoading as their default.
          // Explicit segment fallbacks must pass through unchanged.
          createElement(Suspense, {
            ...suspenseElement.props,
            fallback: <RouteSegmentSkeleton />,
            key: suspenseElement.key,
          })
        : route.element;

    // `RouteObject` is a discriminated union of index / non-index routes, and
    // spreading loses the discriminant — the copy keeps the original's shape.
    return {
      ...route,
      ...(route.children && { children: withSegmentFallback(route.children) }),
      element,
    } as RouteObject;
  });

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
