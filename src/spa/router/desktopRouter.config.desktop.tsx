'use client';

import {
  BrainCircuit,
  FilePenIcon,
  Home,
  Image,
  LibraryBigIcon,
  Settings,
  ShapesIcon,
} from 'lucide-react';
import type { RouteObject } from 'react-router';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
} from '@/business/client/BusinessDesktopRoutes';
import { agentDocumentRouteMeta } from '@/features/AgentDocumentPage/routeMeta';
import { taskRouteMeta, tasksRouteMeta } from '@/features/AgentTasks/routeMeta';
import { fleetRouteMeta } from '@/features/Fleet/routeMeta';
import { pageRouteMeta } from '@/features/Pages/routeMeta';
import { verifyRouteMeta } from '@/features/Verify/routeMeta';
import { workspaceHomeRouteMeta } from '@/features/Workspace/routeMeta';
import DesktopOnboarding from '@/routes/(desktop)/desktop-onboarding';
// Layouts — sync import (Electron local, no network overhead)
import DesktopMainLayout from '@/routes/(main)/_layout';
import ImagePage from '@/routes/(main)/(create)/image';
import DesktopImageLayout from '@/routes/(main)/(create)/image/_layout';
import VideoPage from '@/routes/(main)/(create)/video';
import DesktopVideoLayout from '@/routes/(main)/(create)/video/_layout';
import TaskWorkspaceLayout from '@/routes/(main)/(task-workspace)/_layout';
import WorkspaceSlugLayout from '@/routes/(main)/[workspaceSlug]/_layout';
import WorkspaceSlugSettingsIndexPage from '@/routes/(main)/[workspaceSlug]/settings';
import WorkspaceSlugSettingsContentLayout from '@/routes/(main)/[workspaceSlug]/settings/_content-layout';
import WorkspaceSlugSettingsLayout from '@/routes/(main)/[workspaceSlug]/settings/_layout';
import WorkspaceSlugSettingsApiKeyPage from '@/routes/(main)/[workspaceSlug]/settings/apikey';
import WorkspaceSlugSettingsBillingPage from '@/routes/(main)/[workspaceSlug]/settings/billing';
import WorkspaceSlugSettingsCreditsPage from '@/routes/(main)/[workspaceSlug]/settings/credits';
import WorkspaceSlugSettingsCredsPage from '@/routes/(main)/[workspaceSlug]/settings/creds';
import WorkspaceSlugSettingsDevicesPage from '@/routes/(main)/[workspaceSlug]/settings/devices';
import WorkspaceSlugSettingsGeneralPage from '@/routes/(main)/[workspaceSlug]/settings/general';
import WorkspaceSlugSettingsMembersPage from '@/routes/(main)/[workspaceSlug]/settings/members';
import WorkspaceSlugSettingsPlansPage from '@/routes/(main)/[workspaceSlug]/settings/plans';
import WorkspaceSlugSettingsProviderPage from '@/routes/(main)/[workspaceSlug]/settings/provider';
import WorkspaceSlugSettingsServiceModelPage from '@/routes/(main)/[workspaceSlug]/settings/service-model';
import WorkspaceSlugSettingsSkillPage from '@/routes/(main)/[workspaceSlug]/settings/skill';
import WorkspaceSlugSettingsStatsPage from '@/routes/(main)/[workspaceSlug]/settings/stats';
import WorkspaceSlugSettingsStoragePage from '@/routes/(main)/[workspaceSlug]/settings/storage';
import WorkspaceSlugSettingsUsagePage from '@/routes/(main)/[workspaceSlug]/settings/usage';
// Pages — sync import
import AgentPage from '@/routes/(main)/agent';
import DesktopChatLayout from '@/routes/(main)/agent/_layout';
import DesktopAgentChatLayout from '@/routes/(main)/agent/(chat)/_layout';
import AgentChannelPage from '@/routes/(main)/agent/channel';
import AgentDocumentLayout from '@/routes/(main)/agent/docs/_layout';
import AgentDocumentRoute from '@/routes/(main)/agent/docs/[docId]';
import { agentRouteMeta } from '@/routes/(main)/agent/features/routeMeta';
import AgentProfilePage from '@/routes/(main)/agent/profile';
import AgentTaskDetailRoute from '@/routes/(main)/agent/task/[taskId]';
import AgentScopedTasksRoute from '@/routes/(main)/agent/tasks';
import AgentTopicsPage from '@/routes/(main)/agent/topics';
import CommunityLayout from '@/routes/(main)/community/_layout';
import CommunityDetailLayout from '@/routes/(main)/community/(detail)/_layout';
import CommunityDetailAgentPage from '@/routes/(main)/community/(detail)/agent';
import CommunityDetailGroupAgentPage from '@/routes/(main)/community/(detail)/group_agent';
import CommunityDetailMcpPage from '@/routes/(main)/community/(detail)/mcp';
import CommunityDetailModelPage from '@/routes/(main)/community/(detail)/model';
import CommunityDetailOrganizationPage from '@/routes/(main)/community/(detail)/organization';
import CommunityDetailProviderPage from '@/routes/(main)/community/(detail)/provider';
import CommunityDetailSkillPage from '@/routes/(main)/community/(detail)/skill';
import CommunityDetailUserPage from '@/routes/(main)/community/(detail)/user';
import CommunityDetailWorkspacePage from '@/routes/(main)/community/(detail)/workspace';
import CommunityDetailWorkspaceSettingsPage from '@/routes/(main)/community/(detail)/workspace/settings';
import CommunityListLayout from '@/routes/(main)/community/(list)/_layout';
import CommunityListHomePage from '@/routes/(main)/community/(list)/(home)';
import CommunityListAgentPage from '@/routes/(main)/community/(list)/agent';
import CommunityListAgentLayout from '@/routes/(main)/community/(list)/agent/_layout';
import CommunityListMcpPage from '@/routes/(main)/community/(list)/mcp';
import CommunityListMcpLayout from '@/routes/(main)/community/(list)/mcp/_layout';
import CommunityListModelPage from '@/routes/(main)/community/(list)/model';
import CommunityListModelLayout from '@/routes/(main)/community/(list)/model/_layout';
import CommunityListProviderPage from '@/routes/(main)/community/(list)/provider';
import CommunityListSkillPage from '@/routes/(main)/community/(list)/skill';
import CommunityListSkillLayout from '@/routes/(main)/community/(list)/skill/_layout';
import DevtoolsIndexPage from '@/routes/(main)/devtools';
import DevtoolsLayout from '@/routes/(main)/devtools/_layout';
import DevtoolsToolPage from '@/routes/(main)/devtools/[identifier]';
import EvalOverviewPage from '@/routes/(main)/eval';
import EvalLayout from '@/routes/(main)/eval/_layout';
import EvalHomeLayout from '@/routes/(main)/eval/(home)/_layout';
import EvalBenchmarkDetailPage from '@/routes/(main)/eval/bench/[benchmarkId]';
import EvalBenchLayout from '@/routes/(main)/eval/bench/[benchmarkId]/_layout';
import EvalDatasetDetailPage from '@/routes/(main)/eval/bench/[benchmarkId]/datasets/[datasetId]';
import EvalRunDetailPage from '@/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]';
import EvalCaseDetailPage from '@/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]/cases/[caseId]';
import FleetPage from '@/routes/(main)/fleet';
import GroupPage from '@/routes/(main)/group';
import DesktopGroupLayout from '@/routes/(main)/group/_layout';
import { groupRouteMeta } from '@/routes/(main)/group/features/routeMeta';
import GroupProfilePage from '@/routes/(main)/group/profile';
import DesktopMemoryLayout from '@/routes/(main)/memory/_layout';
import MemoryHomePage from '@/routes/(main)/memory/(home)';
import MemoryActivitiesPage from '@/routes/(main)/memory/activities';
import MemoryContextsPage from '@/routes/(main)/memory/contexts';
import MemoryExperiencesPage from '@/routes/(main)/memory/experiences';
import MemoryIdentitiesPage from '@/routes/(main)/memory/identities';
import MemoryPreferencesPage from '@/routes/(main)/memory/preferences';
import PageIndexPage from '@/routes/(main)/page';
import DesktopPageLayout from '@/routes/(main)/page/_layout';
import PageDetailPage from '@/routes/(main)/page/[id]';
import ResourceLayout from '@/routes/(main)/resource/_layout';
import ResourceHomePage from '@/routes/(main)/resource/(home)';
import ResourceHomeLayout from '@/routes/(main)/resource/(home)/_layout';
import ResourceLibraryPage from '@/routes/(main)/resource/library';
import ResourceLibraryLayout from '@/routes/(main)/resource/library/_layout';
import ResourceLibrarySlugPage from '@/routes/(main)/resource/library/[slug]';
import SettingsTabPage from '@/routes/(main)/settings';
import SettingsLayout from '@/routes/(main)/settings/_layout';
import { settingsRouteMeta } from '@/routes/(main)/settings/features/routeMeta';
import { ProviderDetailPage, ProviderLayout } from '@/routes/(main)/settings/provider';
import TaskDetailRoute from '@/routes/(main)/task/[taskId]';
import AllTasksPage from '@/routes/(main)/tasks';
import SharePagePage from '@/routes/share/page/[id]';
import ShareTopicPage from '@/routes/share/t/[id]';
import ShareTopicLayout from '@/routes/share/t/[id]/_layout';
import { shareTopicRouteMeta } from '@/routes/share/t/[id]/routeMeta';
import VerifyReportPage from '@/routes/verify/[runId]';
import VerifyImPage from '@/routes/verify-im';
import { routeMeta } from '@/spa/router/routeMeta';
import { SettingsTabs } from '@/store/global/initialState';
import { ErrorBoundary, redirectElement } from '@/utils/router';

/**
 * Children shared between `/` and `/:workspaceSlug` for the Electron build.
 * Mirror of the async `sharedMainAreaChildren` — paths must match (the router
 * sync test enforces this).
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
                element: <AgentPage />,
                handle: { meta: agentRouteMeta },
                index: true,
              },
              {
                element: <AgentPage />,
                handle: { meta: agentRouteMeta },
                path: ':topicId',
              },
            ],
            element: <DesktopAgentChatLayout />,
          },
          {
            children: [
              {
                element: <AgentDocumentRoute />,
                handle: { meta: agentDocumentRouteMeta },
                path: ':docId',
              },
            ],
            element: <AgentDocumentLayout />,
            path: 'docs',
          },
          {
            element: <AgentProfilePage />,
            path: 'profile',
          },
          {
            element: <AgentChannelPage />,
            path: 'channel',
          },
          {
            element: <AgentTopicsPage />,
            path: 'topics',
          },
          {
            element: <AgentScopedTasksRoute />,
            handle: { meta: tasksRouteMeta },
            path: 'tasks',
          },
          {
            element: <AgentTaskDetailRoute />,
            handle: { meta: taskRouteMeta },
            path: 'task/:taskId',
          },
        ],
        element: <DesktopChatLayout />,
        errorElement: <ErrorBoundary />,
        path: ':aid',
      },
    ],
    path: 'agent',
  },

  // Fleet view (side-by-side agent dashboard)
  {
    element: <FleetPage />,
    errorElement: <ErrorBoundary />,
    handle: { meta: fleetRouteMeta },
    path: 'fleet',
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
            element: <GroupPage />,
            handle: { meta: groupRouteMeta },
            index: true,
          },
          {
            element: <GroupProfilePage />,
            path: 'profile',
          },
          {
            element: <GroupPage />,
            handle: { meta: groupRouteMeta },
            path: ':topicId',
          },
        ],
        element: <DesktopGroupLayout />,
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
        element: <CommunityDetailWorkspaceSettingsPage />,
        path: 'workspace/settings',
      },
      // List routes (with ListLayout)
      {
        children: [
          {
            children: [
              {
                element: <CommunityListAgentPage />,
                handle: {
                  meta: routeMeta({
                    icon: ShapesIcon,
                    titleKey: 'navigation.discoverAssistants',
                  }),
                },
                index: true,
              },
            ],
            element: <CommunityListAgentLayout />,
            path: 'agent',
          },
          {
            children: [
              {
                element: <CommunityListModelPage />,
                handle: {
                  meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discoverModels' }),
                },
                index: true,
              },
            ],
            element: <CommunityListModelLayout />,
            path: 'model',
          },
          {
            element: <CommunityListProviderPage />,
            handle: {
              meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discoverProviders' }),
            },
            path: 'provider',
          },
          {
            children: [
              {
                element: <CommunityListSkillPage />,
                handle: {
                  meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discover' }),
                },
                index: true,
              },
            ],
            element: <CommunityListSkillLayout />,
            path: 'skill',
          },
          {
            children: [
              {
                element: <CommunityListMcpPage />,
                handle: {
                  meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discoverMcp' }),
                },
                index: true,
              },
            ],
            element: <CommunityListMcpLayout />,
            path: 'mcp',
          },
          {
            element: <CommunityDetailWorkspacePage />,
            path: 'workspace',
          },
          {
            element: <CommunityListHomePage />,
            handle: {
              meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.discover' }),
            },
            index: true,
          },
        ],
        element: <CommunityListLayout />,
      },
      // Detail routes (with DetailLayout)
      {
        children: [
          {
            element: <CommunityDetailAgentPage />,
            path: 'agent/:slug',
          },
          {
            element: <CommunityDetailGroupAgentPage />,
            path: 'group_agent/:slug',
          },
          {
            element: <CommunityDetailModelPage />,
            path: 'model/:slug',
          },
          {
            element: <CommunityDetailProviderPage />,
            path: 'provider/:slug',
          },
          {
            element: <CommunityDetailSkillPage />,
            path: 'skill/:slug',
          },
          {
            element: <CommunityDetailMcpPage />,
            path: 'mcp/:slug',
          },
          {
            element: <CommunityDetailUserPage />,
            path: 'user/:slug',
          },
          {
            element: <CommunityDetailOrganizationPage />,
            path: 'org/:slug',
          },
        ],
        element: <CommunityDetailLayout />,
      },
    ],
    element: <CommunityLayout />,
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
            element: <ResourceHomePage />,
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.resources' }),
            },
            index: true,
          },
        ],
        element: <ResourceHomeLayout />,
      },
      // Library routes (knowledge base detail)
      {
        children: [
          {
            element: <ResourceLibraryPage />,
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
            },
            index: true,
          },
          {
            element: <ResourceLibrarySlugPage />,
            handle: {
              meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
            },
            path: ':slug',
          },
        ],
        element: <ResourceLibraryLayout />,
        path: 'library/:id',
      },
    ],
    element: <ResourceLayout />,
    errorElement: <ErrorBoundary />,
    path: 'resource',
  },

  // Memory routes
  {
    children: [
      {
        element: <MemoryHomePage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
        },
        index: true,
      },
      {
        element: <MemoryIdentitiesPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryIdentities' }),
        },
        path: 'identities',
      },
      {
        element: <MemoryContextsPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryContexts' }),
        },
        path: 'contexts',
      },
      {
        element: <MemoryPreferencesPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryPreferences' }),
        },
        path: 'preferences',
      },
      {
        element: <MemoryExperiencesPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memoryExperiences' }),
        },
        path: 'experiences',
      },
      {
        element: <MemoryActivitiesPage />,
        handle: {
          meta: routeMeta({ icon: BrainCircuit, titleKey: 'navigation.memory' }),
        },
        path: 'activities',
      },
    ],
    element: <DesktopMemoryLayout />,
    errorElement: <ErrorBoundary />,
    path: 'memory',
  },

  // Video routes
  {
    children: [
      {
        element: <VideoPage />,
        index: true,
      },
    ],
    element: <DesktopVideoLayout />,
    errorElement: <ErrorBoundary />,
    path: 'video',
  },

  // Image routes
  {
    children: [
      {
        element: <ImagePage />,
        handle: {
          meta: routeMeta({ icon: Image, titleKey: 'navigation.image' }),
        },
        index: true,
      },
    ],
    element: <DesktopImageLayout />,
    errorElement: <ErrorBoundary />,
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
            element: <EvalOverviewPage />,
            index: true,
          },
        ],
        element: <EvalHomeLayout />,
      },
      // Bench routes (with dedicated sidebar)
      {
        children: [
          {
            element: <EvalBenchmarkDetailPage />,
            index: true,
          },
          {
            children: [
              {
                element: <EvalRunDetailPage />,
                index: true,
              },
              {
                element: <EvalCaseDetailPage />,
                path: 'cases/:caseId',
              },
            ],
            path: 'runs/:runId',
          },
          {
            element: <EvalDatasetDetailPage />,
            path: 'datasets/:datasetId',
          },
        ],
        element: <EvalBenchLayout />,
        path: 'bench/:benchmarkId',
      },
    ],
    element: <EvalLayout />,
    errorElement: <ErrorBoundary />,
    path: 'eval',
  },

  // Task workspace routes (cross-agent)
  {
    children: [
      {
        children: [
          {
            element: <AllTasksPage />,
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
            element: <TaskDetailRoute />,
            handle: { meta: taskRouteMeta },
            path: ':taskId',
          },
        ],
        errorElement: <ErrorBoundary resetPath="../tasks" />,
        path: 'task',
      },
    ],
    element: <TaskWorkspaceLayout />,
  },

  // Pages routes
  {
    children: [
      {
        element: <PageIndexPage />,
        handle: {
          meta: routeMeta({ icon: FilePenIcon, titleKey: 'navigation.pages' }),
        },
        index: true,
      },
      {
        element: <PageDetailPage />,
        handle: { meta: pageRouteMeta },
        path: ':id',
      },
    ],
    element: <DesktopPageLayout />,
    errorElement: <ErrorBoundary />,
    path: 'page',
  },
];

// Desktop router configuration — all sync imports for Electron local build
export const desktopRoutes: RouteObject[] = [
  {
    children: [
      ...sharedMainAreaChildren,

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
                element: <ProviderDetailPage />,
                handle: {
                  meta: routeMeta({ icon: Settings, titleKey: 'navigation.provider' }),
                },
                path: ':providerId',
              },
            ],
            element: <ProviderLayout />,
            handle: {
              meta: routeMeta({ icon: Settings, titleKey: 'navigation.provider' }),
            },
            path: 'provider',
          },
          {
            element: <SettingsTabPage />,
            handle: { settingsTab: SettingsTabs.Memory },
            path: 'memory',
          },
          // Other settings tabs
          {
            element: <SettingsTabPage />,
            handle: { meta: settingsRouteMeta },
            path: ':tab',
          },
          // Tabs that need a sub-segment (e.g. /settings/messenger/discord) reuse
          // the same tab page; nested feature components read `:sub` via useParams.
          {
            element: <SettingsTabPage />,
            handle: { meta: settingsRouteMeta },
            path: ':tab/:sub',
          },
        ],
        element: <SettingsLayout />,
        errorElement: <ErrorBoundary />,
        path: 'settings',
      },

      // Workspace slug routes — `/:workspaceSlug/*` mirrors the shared main area.
      // Must come AFTER all reserved root paths so they don't shadow e.g. /agent.
      {
        children: [
          // Workspace home — handled by the persistent `DesktopHomeLayout`
          // (mirrors `/` index). Adding an element renders Home twice.
          { handle: { meta: workspaceHomeRouteMeta }, index: true },
          ...sharedMainAreaChildren,
          // Workspace settings — `/:slug/settings/*`. Dedicated layout with
          // its own sidebar (workspace avatar + 6 tabs + back-to-chat), fully
          // decoupled from personal `/settings/*`.
          {
            children: [
              { element: <WorkspaceSlugSettingsIndexPage />, index: true },
              // Full-bleed tabs render directly inside the workspace settings
              // shell (sidebar + outlet) — they own their internal layout.
              { element: <WorkspaceSlugSettingsProviderPage />, path: 'provider' },
              { element: <WorkspaceSlugSettingsSkillPage />, path: 'skill' },
              // Padded tabs share a centered, max-width container layout.
              {
                children: [
                  { element: <WorkspaceSlugSettingsGeneralPage />, path: 'general' },
                  { element: <WorkspaceSlugSettingsMembersPage />, path: 'members' },
                  { element: <WorkspaceSlugSettingsStatsPage />, path: 'stats' },
                  { element: <WorkspaceSlugSettingsPlansPage />, path: 'plans' },
                  { element: <WorkspaceSlugSettingsBillingPage />, path: 'billing' },
                  { element: <WorkspaceSlugSettingsCreditsPage />, path: 'credits' },
                  { element: <WorkspaceSlugSettingsUsagePage />, path: 'usage' },
                  { element: <WorkspaceSlugSettingsServiceModelPage />, path: 'service-model' },
                  { element: <WorkspaceSlugSettingsCredsPage />, path: 'creds' },
                  { element: <WorkspaceSlugSettingsApiKeyPage />, path: 'apikey' },
                  { element: <WorkspaceSlugSettingsStoragePage />, path: 'storage' },
                  { element: <WorkspaceSlugSettingsDevicesPage />, path: 'devices' },
                ],
                element: <WorkspaceSlugSettingsContentLayout />,
              },
            ],
            element: <WorkspaceSlugSettingsLayout />,
            errorElement: <ErrorBoundary />,
            path: 'settings',
          },
          // Legacy `/:slug/billing/*` URLs — redirect to `/:slug/settings/*`.
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
        element: <WorkspaceSlugLayout />,
        errorElement: <ErrorBoundary />,
        path: ':workspaceSlug',
      },

      // Default route - home page (handled by persistent layout)
      {
        handle: {
          meta: routeMeta({ icon: Home, titleKey: 'navigation.home' }),
        },
        index: true,
      },
      // Catch-all route
      {
        element: redirectElement('/'),
        path: '*',
      },
    ],
    element: <DesktopMainLayout />,
    errorElement: <ErrorBoundary />,
    path: '/',
  },

  ...BusinessDesktopRoutesWithoutMainLayout,

  // Share topic route (outside main layout)
  {
    children: [
      {
        element: <ShareTopicPage />,
        handle: { meta: shareTopicRouteMeta },
        path: ':id',
      },
    ],
    element: <ShareTopicLayout />,
    path: '/share/t',
  },

  // Share page route (outside main layout)
  {
    children: [
      {
        element: <SharePagePage />,
        path: ':id',
      },
    ],
    path: '/share/page',
  },

  // Messenger verify route (outside main layout)
  {
    element: <VerifyImPage />,
    errorElement: <ErrorBoundary />,
    path: '/verify-im',
  },

  // Standalone verification-report viewer (outside main layout)
  {
    element: <VerifyReportPage />,
    errorElement: <ErrorBoundary />,
    handle: { meta: verifyRouteMeta },
    path: '/verify/:runId',
  },

  // Devtools route (outside main layout, dev-only)
  ...(__DEV__
    ? [
        {
          children: [
            { element: <DevtoolsIndexPage />, index: true },
            { element: <DevtoolsToolPage />, path: ':identifier' },
          ],
          element: <DevtoolsLayout />,
          errorElement: <ErrorBoundary />,
          path: '/devtools',
        },
      ]
    : []),
];

// Desktop owns its onboarding flow. Web-only onboarding routes are intentionally
// absent from Electron so personal onboarding redirects fail visibly instead of
// looping back into desktop login.
desktopRoutes.push({
  element: <DesktopOnboarding />,
  errorElement: <ErrorBoundary />,
  path: '/desktop-onboarding',
});
