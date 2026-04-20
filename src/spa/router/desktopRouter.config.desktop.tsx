'use client';

import type { RouteObject } from 'react-router-dom';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
} from '@/business/client/BusinessDesktopRoutes';
import DesktopOnboarding from '@/routes/(desktop)/desktop-onboarding';
// Layouts — sync import (Electron local, no network overhead)
import DesktopMainLayout from '@/routes/(main)/_layout';
import ImagePage from '@/routes/(main)/(create)/image';
import DesktopImageLayout from '@/routes/(main)/(create)/image/_layout';
import VideoPage from '@/routes/(main)/(create)/video';
import DesktopVideoLayout from '@/routes/(main)/(create)/video/_layout';
// Pages — sync import
import AgentPage from '@/routes/(main)/agent';
import DesktopChatLayout from '@/routes/(main)/agent/_layout';
import AgentChannelPage from '@/routes/(main)/agent/channel';
import AgentCronDetailPage from '@/routes/(main)/agent/cron/[cronId]';
import AgentProfilePage from '@/routes/(main)/agent/profile';
import CommunityLayout from '@/routes/(main)/community/_layout';
import CommunityDetailLayout from '@/routes/(main)/community/(detail)/_layout';
import CommunityDetailAgentPage from '@/routes/(main)/community/(detail)/agent';
import CommunityDetailGroupAgentPage from '@/routes/(main)/community/(detail)/group_agent';
import CommunityDetailMcpPage from '@/routes/(main)/community/(detail)/mcp';
import CommunityDetailModelPage from '@/routes/(main)/community/(detail)/model';
import CommunityDetailProviderPage from '@/routes/(main)/community/(detail)/provider';
import CommunityDetailSkillPage from '@/routes/(main)/community/(detail)/skill';
import CommunityDetailUserPage from '@/routes/(main)/community/(detail)/user';
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
import EvalOverviewPage from '@/routes/(main)/eval';
import EvalLayout from '@/routes/(main)/eval/_layout';
import EvalHomeLayout from '@/routes/(main)/eval/(home)/_layout';
import EvalBenchmarkDetailPage from '@/routes/(main)/eval/bench/[benchmarkId]';
import EvalBenchLayout from '@/routes/(main)/eval/bench/[benchmarkId]/_layout';
import EvalDatasetDetailPage from '@/routes/(main)/eval/bench/[benchmarkId]/datasets/[datasetId]';
import EvalRunDetailPage from '@/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]';
import EvalCaseDetailPage from '@/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]/cases/[caseId]';
import GroupPage from '@/routes/(main)/group';
import DesktopGroupLayout from '@/routes/(main)/group/_layout';
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
import { ProviderDetailPage, ProviderLayout } from '@/routes/(main)/settings/provider';
import ShareTopicPage from '@/routes/share/t/[id]';
import ShareTopicLayout from '@/routes/share/t/[id]/_layout';
import { ErrorBoundary, redirectElement } from '@/utils/router';

// Desktop router configuration — all sync imports for Electron local build
export const desktopRoutes: RouteObject[] = [
  {
    children: [
      // Chat routes (agent)
      {
        children: [
          {
            element: redirectElement('/'),
            index: true,
          },
          {
            children: [
              {
                element: <AgentPage />,
                index: true,
              },
              {
                element: <AgentProfilePage />,
                path: 'profile',
              },
              {
                element: <AgentCronDetailPage />,
                path: 'cron/:cronId',
              },
              {
                element: <AgentChannelPage />,
                path: 'channel',
              },
            ],
            element: <DesktopChatLayout />,
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
            element: redirectElement('/'),
            index: true,
          },
          {
            children: [
              {
                element: <GroupPage />,
                index: true,
              },
              {
                element: <GroupProfilePage />,
                path: 'profile',
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
          // List routes (with ListLayout)
          {
            children: [
              {
                children: [
                  {
                    element: <CommunityListAgentPage />,
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
                    index: true,
                  },
                ],
                element: <CommunityListModelLayout />,
                path: 'model',
              },
              {
                element: <CommunityListProviderPage />,
                path: 'provider',
              },
              {
                children: [
                  {
                    element: <CommunityListSkillPage />,
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
                    index: true,
                  },
                ],
                element: <CommunityListMcpLayout />,
                path: 'mcp',
              },
              {
                element: <CommunityListHomePage />,
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
                index: true,
              },
              {
                element: <ResourceLibrarySlugPage />,
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

      // Settings routes
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
                path: ':providerId',
              },
            ],
            element: <ProviderLayout />,
            path: 'provider',
          },
          // Other settings tabs
          {
            element: <SettingsTabPage />,
            path: ':tab',
          },
        ],
        element: <SettingsLayout />,
        errorElement: <ErrorBoundary />,
        path: 'settings',
      },

      // Memory routes
      {
        children: [
          {
            element: <MemoryHomePage />,
            index: true,
          },
          {
            element: <MemoryIdentitiesPage />,
            path: 'identities',
          },
          {
            element: <MemoryContextsPage />,
            path: 'contexts',
          },
          {
            element: <MemoryPreferencesPage />,
            path: 'preferences',
          },
          {
            element: <MemoryExperiencesPage />,
            path: 'experiences',
          },
          {
            element: <MemoryActivitiesPage />,
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

      // Pages routes
      {
        children: [
          {
            element: <PageIndexPage />,
            index: true,
          },
          {
            element: <PageDetailPage />,
            path: ':id',
          },
        ],
        element: <DesktopPageLayout />,
        errorElement: <ErrorBoundary />,
        path: 'page',
      },

      // Default route - home page (handled by persistent layout)
      {
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
        path: ':id',
      },
    ],
    element: <ShareTopicLayout />,
    path: '/share/t',
  },
];

// Desktop onboarding route (Electron only in .desktop.tsx)
desktopRoutes.push({
  element: <DesktopOnboarding />,
  errorElement: <ErrorBoundary />,
  path: '/desktop-onboarding',
});

// Web onboarding aliases redirect to the desktop-specific onboarding flow.
desktopRoutes.push({
  element: redirectElement('/desktop-onboarding'),
  errorElement: <ErrorBoundary />,
  path: '/onboarding',
});

desktopRoutes.push({
  element: redirectElement('/desktop-onboarding'),
  errorElement: <ErrorBoundary />,
  path: '/onboarding/agent',
});

desktopRoutes.push({
  element: redirectElement('/desktop-onboarding'),
  errorElement: <ErrorBoundary />,
  path: '/onboarding/classic',
});
