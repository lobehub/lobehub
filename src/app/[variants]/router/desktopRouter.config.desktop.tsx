'use client';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
} from '@/business/client/BusinessDesktopRoutes';
import { type RouteConfig } from '@/utils/router';
import { ErrorBoundary, redirectElement } from '@/utils/router';

import DesktopOnboarding from '../(desktop)/desktop-onboarding';
// Layouts — sync import (Electron local, no network overhead)
import DesktopMainLayout from '../(main)/_layout';
// Pages — sync import
import AgentPage from '../(main)/agent';
import DesktopChatLayout from '../(main)/agent/_layout';
import AgentCronDetailPage from '../(main)/agent/cron/[cronId]';
import AgentProfilePage from '../(main)/agent/profile';
import CommunityLayout from '../(main)/community/_layout';
import CommunityDetailLayout from '../(main)/community/(detail)/_layout';
import CommunityDetailAgentPage from '../(main)/community/(detail)/agent';
import CommunityDetailGroupAgentPage from '../(main)/community/(detail)/group_agent';
import CommunityDetailMcpPage from '../(main)/community/(detail)/mcp';
import CommunityDetailModelPage from '../(main)/community/(detail)/model';
import CommunityDetailProviderPage from '../(main)/community/(detail)/provider';
import CommunityDetailUserPage from '../(main)/community/(detail)/user';
import CommunityListLayout from '../(main)/community/(list)/_layout';
import CommunityListHomePage from '../(main)/community/(list)/(home)';
import CommunityListAgentPage from '../(main)/community/(list)/agent';
import CommunityListAgentLayout from '../(main)/community/(list)/agent/_layout';
import CommunityListMcpPage from '../(main)/community/(list)/mcp';
import CommunityListMcpLayout from '../(main)/community/(list)/mcp/_layout';
import CommunityListModelPage from '../(main)/community/(list)/model';
import CommunityListModelLayout from '../(main)/community/(list)/model/_layout';
import CommunityListProviderPage from '../(main)/community/(list)/provider';
import EvalOverviewPage from '../(main)/eval';
import EvalLayout from '../(main)/eval/_layout';
import EvalHomeLayout from '../(main)/eval/(home)/_layout';
import EvalBenchmarkDetailPage from '../(main)/eval/bench/[benchmarkId]';
import EvalBenchLayout from '../(main)/eval/bench/[benchmarkId]/_layout';
import EvalDatasetDetailPage from '../(main)/eval/bench/[benchmarkId]/datasets/[datasetId]';
import EvalRunDetailPage from '../(main)/eval/bench/[benchmarkId]/runs/[runId]';
import EvalCaseDetailPage from '../(main)/eval/bench/[benchmarkId]/runs/[runId]/cases/[caseId]';
import GroupPage from '../(main)/group';
import DesktopGroupLayout from '../(main)/group/_layout';
import GroupProfilePage from '../(main)/group/profile';
import ImagePage from '../(main)/image';
import DesktopImageLayout from '../(main)/image/_layout';
import DesktopMemoryLayout from '../(main)/memory/_layout';
import MemoryHomePage from '../(main)/memory/(home)';
import MemoryActivitiesPage from '../(main)/memory/activities';
import MemoryContextsPage from '../(main)/memory/contexts';
import MemoryExperiencesPage from '../(main)/memory/experiences';
import MemoryIdentitiesPage from '../(main)/memory/identities';
import MemoryPreferencesPage from '../(main)/memory/preferences';
import PageIndexPage from '../(main)/page';
import DesktopPageLayout from '../(main)/page/_layout';
import PageDetailPage from '../(main)/page/[id]';
import ResourceLayout from '../(main)/resource/_layout';
import ResourceHomePage from '../(main)/resource/(home)';
import ResourceHomeLayout from '../(main)/resource/(home)/_layout';
import ResourceLibraryPage from '../(main)/resource/library';
import ResourceLibraryLayout from '../(main)/resource/library/_layout';
import ResourceLibrarySlugPage from '../(main)/resource/library/[slug]';
import SettingsTabPage from '../(main)/settings';
import SettingsLayout from '../(main)/settings/_layout';
import { ProviderDetailPage, ProviderLayout } from '../(main)/settings/provider';
import VideoPage from '../(main)/video';
import DesktopVideoLayout from '../(main)/video/_layout';
import ShareTopicPage from '../share/t/[id]';
import ShareTopicLayout from '../share/t/[id]/_layout';

// Desktop router configuration — all sync imports for Electron local build
export const desktopRoutes: RouteConfig[] = [
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
            ],
            element: <DesktopChatLayout />,
            errorElement: <ErrorBoundary resetPath="/agent" />,
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
            errorElement: <ErrorBoundary resetPath="/group" />,
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
        errorElement: <ErrorBoundary resetPath="/community" />,
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
        errorElement: <ErrorBoundary resetPath="/resource" />,
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
        errorElement: <ErrorBoundary resetPath="/settings" />,
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
        errorElement: <ErrorBoundary resetPath="/memory" />,
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
        errorElement: <ErrorBoundary resetPath="/video" />,
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
        errorElement: <ErrorBoundary resetPath="/image" />,
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
        errorElement: <ErrorBoundary resetPath="/eval" />,
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
        errorElement: <ErrorBoundary resetPath="/page" />,
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
    errorElement: <ErrorBoundary resetPath="/" />,
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
  errorElement: <ErrorBoundary resetPath="/" />,
  path: '/desktop-onboarding',
});
