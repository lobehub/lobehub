'use client';

import type { RouteObject } from 'react-router';

import {
  BusinessMobileRoutesWithMainLayout,
  BusinessMobileRoutesWithoutMainLayout,
} from '@/business/client/BusinessMobileRoutes';
import AppsSkeleton from '@/components/Skeleton/Apps';
import CommunityListSkeleton from '@/components/Skeleton/CommunityList';
import { delayed } from '@/components/Skeleton/Delayed';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { acceptanceRouteMeta } from '@/features/Acceptance/routeMeta';
import { mobileAgentRoute, mobileGroupRoute } from '@/spa/router/mobileAgentRoutes';
import { mobileUnsupportedRoutes, mobileWorkspaceRoutes } from '@/spa/router/mobileWorkspaceRoutes';
import { mobileWorkspaceSettingsChildren } from '@/spa/router/mobileWorkspaceSettingsRoutes';
import { routeMeta } from '@/spa/router/routeMeta';
import { SettingsTabs } from '@/store/global/initialState';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

// One element per shape, shared by every tab: switching tabs keeps the page
// mounted instead of swapping in a new lazy component.
const settingsTabElement = dynamicElement(
  () => import('@/routes/(main)/settings'),
  'Mobile > Settings > Tab',
  { preloadId: 'mobile-settings' },
);
const settingsTabSubElement = dynamicElement(
  () => import('@/routes/(main)/settings'),
  'Mobile > Settings > Tab > Sub',
  { preloadId: 'mobile-settings' },
);

const personalSettingsTabRoutes: RouteObject[] = [...new Set(Object.values(SettingsTabs))]
  .filter((tab) => tab !== SettingsTabs.Provider && tab !== SettingsTabs.Creds)
  .flatMap((tab) => [
    { element: settingsTabElement, handle: { settingsTab: tab }, path: tab },
    { element: settingsTabSubElement, handle: { settingsTab: tab }, path: `${tab}/:sub` },
  ]);

// Mobile owns its home layout; it has no persistent desktop Home outside the outlet.
const mobileHomeRoute: RouteObject = {
  children: [
    {
      element: dynamicElement(() => import('@/routes/(mobile)/(home)/'), 'Mobile > Home', {
        preloadId: 'mobile-home',
      }),
      index: true,
    },
  ],
  element: dynamicLayout(
    () => import('@/routes/(mobile)/(home)/_layout'),
    'Mobile > Home > Layout',
    { preloadId: 'mobile-home' },
  ),
  handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
};

/**
 * Children shared between `/` and `/:workspaceSlug` for mobile. Mobile only
 * mirrors the subset of routes it actually supports — settings / me stay personal-only.
 */
export const sharedMainAreaChildren: RouteObject[] = [
  mobileAgentRoute,
  mobileGroupRoute,

  // Discover routes with nested structure
  {
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/community/(detail)/workspace/settings'),
          'Mobile > Discover > Workspace > Settings',
        ),
        path: 'workspace/settings',
      },
      // List routes (with ListLayout)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/(home)'),
              'Mobile > Discover > List > Home',
              { preloadId: 'mobile-community' },
            ),
            index: true,
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/agent'),
                  'Mobile > Discover > List > Agent',
                ),
                path: 'agent',
              },
            ],
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/model'),
                  'Mobile > Discover > List > Model',
                ),
                path: 'model',
              },
            ],
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/provider'),
              'Mobile > Discover > List > Provider',
            ),
            path: 'provider',
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/community/(list)/mcp'),
                  'Mobile > Discover > List > MCP',
                ),
                path: 'mcp',
              },
            ],
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/skill'),
              'Mobile > Discover > List > Skill',
            ),
            path: 'skill',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/workspace').then(
                  (m) => m.MobileWorkspaceDetailPage,
                ),
              'Mobile > Discover > List > Workspace',
            ),
            handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('detail') }) },
            path: 'workspace',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(mobile)/community/(list)/_layout'),
          'Mobile > Discover > List > Layout',
          { preloadId: 'mobile-community' },
        ),
        handle: { meta: routeMeta({ Skeleton: CommunityListSkeleton }) },
      },
      // Detail routes (with DetailLayout)
      {
        children: [
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/agent').then(
                  (m) => m.MobileDiscoverAssistantDetailPage,
                ),
              'Mobile > Discover > Detail > Agent',
            ),
            path: 'agent/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/model').then((m) => m.MobileModelPage),
              'Mobile > Discover > Detail > Model',
            ),
            path: 'model/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/provider').then(
                  (m) => m.MobileProviderPage,
                ),
              'Mobile > Discover > Detail > Provider',
            ),
            path: 'provider/:slug',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/mcp').then((m) => m.MobileMcpPage),
              'Mobile > Discover > Detail > MCP',
            ),
            path: 'mcp/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/skill').then((m) => m.MobileSkillPage),
              'Mobile > Discover > Detail > Skill',
            ),
            path: 'skill/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/group_agent').then(
                  (m) => m.MobileGroupAgentDetailPage,
                ),
              'Mobile > Discover > Detail > Group Agent',
            ),
            path: 'group_agent/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/user').then(
                  (m) => m.MobileUserDetailPage,
                ),
              'Mobile > Discover > Detail > User',
            ),
            path: 'user/:slug',
          },
          {
            element: dynamicElement(
              () =>
                import('@/routes/(main)/community/(detail)/organization').then(
                  (m) => m.MobileOrganizationDetailPage,
                ),
              'Mobile > Discover > Detail > Organization',
            ),
            path: 'org/:slug',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(mobile)/community/(detail)/_layout'),
          'Mobile > Discover > Detail > Layout',
        ),
        handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('detail') }) },
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(mobile)/community/_layout'),
      'Mobile > Discover > Layout',
      { preloadId: 'mobile-community' },
    ),
    errorElement: <ErrorBoundary />,
    path: 'community',
  },

  // Agents view-all route (flat list of workspace/private agents)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/(main)/agents'), 'Mobile > Agents', {
          preloadId: 'mobile-agents',
        }),
        index: true,
      },
    ],
    errorElement: <ErrorBoundary resetPath=".." />,
    path: 'agents',
  },

  // Tasks, goals, projects, resources, memory, pages, generation, dashboards
  ...mobileWorkspaceRoutes,
  ...mobileUnsupportedRoutes,

  ...BusinessMobileRoutesWithMainLayout,
];

// Mobile router configuration (declarative mode)
export const mobileRoutes: RouteObject[] = [
  {
    children: [
      ...sharedMainAreaChildren,

      // Apps page (personal-only — never mirrored under /:workspaceSlug)
      {
        element: dynamicElement(() => import('@/routes/(main)/apps'), 'Mobile > Apps', {
          fallback: delayed(<AppsSkeleton />),
        }),
        errorElement: <ErrorBoundary />,
        path: 'apps',
      },

      // Settings routes (personal-only — never mirrored under /:workspaceSlug)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(mobile)/settings'),
              'Mobile > Settings',
              { preloadId: 'mobile-settings' },
            ),
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
                  () =>
                    import('@/routes/(main)/settings/provider').then((m) => m.ProviderDetailPage),
                  'Mobile > Settings > Provider > Detail',
                ),
                path: ':providerId',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(mobile)/settings/provider/_layout'),
              'Mobile > Settings > Provider > Layout',
            ),
            path: 'provider',
          },
          {
            element: redirectElement('/settings/credential'),
            path: 'creds',
          },
          // Every known tab gets a static segment: `/settings/memory` and
          // `/:workspaceSlug/memory` (or `/agent`, `/image`, …) tie on route
          // score, and the workspace tree would read `settings` as a slug.
          ...personalSettingsTabRoutes,
          // Other settings tabs (common, agent, memory, tts, about, etc.)
          { element: settingsTabElement, path: ':tab' },
          { element: settingsTabSubElement, path: ':tab/:sub' },
        ],
        element: dynamicLayout(
          () => import('@/routes/(mobile)/settings/_layout'),
          'Mobile > Settings > Layout',
          { preloadId: 'mobile-settings' },
        ),
        errorElement: <ErrorBoundary />,
        path: 'settings',
      },

      // Me routes (mobile personal center — never mirrored under /:workspaceSlug)
      {
        children: [
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(mobile)/me/(home)'),
                  'Mobile > Me > Home',
                ),
                index: true,
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(mobile)/me/(home)/layout'),
              'Mobile > Me > Home > Layout',
            ),
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(mobile)/me/profile'),
                  'Mobile > Me > Profile',
                ),
                path: 'profile',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(mobile)/me/profile/layout'),
              'Mobile > Me > Profile > Layout',
            ),
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(mobile)/me/settings'),
                  'Mobile > Me > Settings',
                ),
                path: 'settings',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(mobile)/me/settings/layout'),
              'Mobile > Me > Settings > Layout',
            ),
          },
        ],
        errorElement: <ErrorBoundary />,
        path: 'me',
      },

      // Default route - home page
      mobileHomeRoute,

      // Workspace slug routes — `/:workspaceSlug/*` mirrors the shared main area.
      // Must come AFTER all reserved root paths so they don't shadow e.g. /agent.
      {
        children: [
          mobileHomeRoute,
          ...sharedMainAreaChildren,
          // Workspace settings — `/:slug/settings/*`. Mobile reuses the mobile
          // settings chrome (header + content wrapper) for now; a dedicated
          // mobile workspace sidebar is follow-up work.
          {
            children: mobileWorkspaceSettingsChildren,
            element: dynamicLayout(
              () => import('@/routes/(mobile)/settings/_layout'),
              'Mobile > Workspace > Settings > Layout',
            ),
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
        element: dynamicLayout(
          () => import('@/routes/(main)/[workspaceSlug]/_layout'),
          'Mobile > Workspace > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: ':workspaceSlug',
      },

      // Catch-all route
      {
        element: redirectElement('/'),
        path: '*',
      },
    ],
    element: dynamicLayout(() => import('@/routes/(mobile)/_layout'), 'Mobile > Main > Layout'),
    errorElement: <ErrorBoundary />,
    path: '/',
  },
  // Onboarding route (outside main layout)
  {
    element: dynamicElement(() => import('@/routes/onboarding'), 'Mobile > Onboarding'),
    errorElement: <ErrorBoundary />,
    path: '/onboarding',
  },
  ...BusinessMobileRoutesWithoutMainLayout,

  // Messenger verify route (outside main layout)
  {
    element: dynamicElement(() => import('@/routes/verify-im'), 'Mobile > VerifyIm'),
    errorElement: <ErrorBoundary />,
    path: '/verify-im',
  },

  {
    element: dynamicElement(
      () => import('@/routes/acceptance/[acceptanceId]'),
      'Mobile > AcceptanceReport',
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: acceptanceRouteMeta },
    path: '/acceptance/:acceptanceId',
  },
  {
    element: dynamicElement(
      () => import('@/routes/acceptance/[acceptanceId]'),
      'Mobile > AcceptanceCheck',
    ),
    errorElement: <ErrorBoundary />,
    handle: { meta: acceptanceRouteMeta },
    path: '/acceptance/:acceptanceId/check/:checkId',
  },
  // Workspace-scoped report links (`/:workspaceSlug/acceptance/...`) are what
  // in-app navigation produces inside a workspace; mirror them like desktop.
  {
    children: [
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/acceptance/[acceptanceId]'),
              'Mobile > Workspace > AcceptanceReport',
            ),
            errorElement: <ErrorBoundary />,
            handle: { meta: acceptanceRouteMeta },
            path: 'acceptance/:acceptanceId',
          },
          {
            element: dynamicElement(
              () => import('@/routes/acceptance/[acceptanceId]'),
              'Mobile > Workspace > AcceptanceCheck',
            ),
            errorElement: <ErrorBoundary />,
            handle: { meta: acceptanceRouteMeta },
            path: 'acceptance/:acceptanceId/check/:checkId',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/[workspaceSlug]/_layout'),
          'Mobile > Workspace > Acceptance Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: ':workspaceSlug',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/acceptance/_layout'),
      'Mobile > Acceptance Layout',
    ),
  },
];
