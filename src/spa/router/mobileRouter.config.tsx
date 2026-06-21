'use client';

import type { RouteObject } from 'react-router';

import {
  BusinessMobileRoutesWithMainLayout,
  BusinessMobileRoutesWithoutMainLayout,
} from '@/business/client/BusinessMobileRoutes';
import { mobileAgentSettingsRouteMeta } from '@/features/RouteMeta/mobileRouteMeta';
import { verifyRouteMeta } from '@/features/Verify/routeMeta';
import { agentRouteMeta } from '@/routes/(main)/agent/features/routeMeta';
import { shareTopicRouteMeta } from '@/routes/share/t/[id]/routeMeta';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

/**
 * Children shared between `/` and `/:workspaceSlug` for mobile. Mobile only
 * mirrors the subset of routes it actually supports — settings / me / default
 * home stay personal-only.
 */
export const sharedMainAreaChildren: RouteObject[] = [
  // Chat routes
  {
    children: [
      {
        element: redirectElement('..'),
        index: true,
      },
      {
        children: [
          {
            element: dynamicElement(() => import('@/routes/(mobile)/chat'), 'Mobile > Chat'),
            handle: { meta: agentRouteMeta },
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(mobile)/chat'),
              'Mobile > Chat > Topic',
            ),
            handle: { meta: agentRouteMeta },
            path: ':topicId',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(mobile)/chat/settings'),
              'Mobile > Chat > Settings',
            ),
            handle: { meta: mobileAgentSettingsRouteMeta },
            path: 'settings',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(mobile)/chat/_layout'),
          'Mobile > Chat > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: ':aid',
      },
    ],
    path: 'agent',
  },

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
              () =>
                import('@/routes/(main)/community/(detail)/workspace').then(
                  (m) => m.MobileWorkspaceDetailPage,
                ),
              'Mobile > Discover > List > Workspace',
            ),
            path: 'workspace',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(mobile)/community/(list)/_layout'),
          'Mobile > Discover > List > Layout',
        ),
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
      },
    ],
    element: dynamicElement(
      () => import('@/routes/(mobile)/community/_layout'),
      'Mobile > Discover > Layout',
    ),
    errorElement: <ErrorBoundary />,
    path: 'community',
  },

  // Task workspace routes (cross-agent)
  {
    children: [
      {
        children: [
          {
            element: dynamicElement(() => import('@/routes/(main)/tasks'), 'Mobile > Tasks'),
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
              'Mobile > Task Detail',
            ),
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
              () => import('@/routes/(main)/agent/task/[taskId]'),
              'Mobile > Agent Task Detail',
            ),
            path: ':aid/task/:taskId',
          },
        ],
        errorElement: <ErrorBoundary resetPath="../tasks" />,
        path: 'agent',
      },
    ],
    element: dynamicLayout(
      () => import('@/routes/(main)/(task-workspace)/_layout'),
      'Mobile > Task Workspace > Layout',
    ),
  },

  ...BusinessMobileRoutesWithMainLayout,
];

// Mobile router configuration (declarative mode)
export const mobileRoutes: RouteObject[] = [
  {
    children: [
      ...sharedMainAreaChildren,

      // Settings routes (personal-only — never mirrored under /:workspaceSlug)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(mobile)/settings'),
              'Mobile > Settings',
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
          // Other settings tabs (common, agent, memory, tts, about, etc.)
          {
            element: dynamicElement(
              () => import('@/routes/(main)/settings'),
              'Mobile > Settings > Tab',
            ),
            path: ':tab',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(mobile)/settings/_layout'),
          'Mobile > Settings > Layout',
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
      {
        children: [
          {
            element: dynamicElement(() => import('@/routes/(mobile)/(home)/'), 'Mobile > Home'),
            index: true,
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(mobile)/(home)/_layout'),
          'Mobile > Home > Layout',
        ),
      },

      // Workspace slug routes — `/:workspaceSlug/*` mirrors the shared main area.
      // Must come AFTER all reserved root paths so they don't shadow e.g. /agent.
      {
        children: [
          // Workspace home — handled by the persistent home layout (mirrors
          // how `/` index is empty); rendering here would duplicate Home.
          {
            index: true,
          },
          ...sharedMainAreaChildren,
          // Workspace settings — `/:slug/settings/*`. Mobile reuses the mobile
          // settings chrome (header + content wrapper) for now; a dedicated
          // mobile workspace sidebar is follow-up work.
          {
            children: [
              { element: redirectElement('general'), index: true },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/general'),
                  'Mobile > Workspace > Settings > General',
                ),
                path: 'general',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/members'),
                  'Mobile > Workspace > Settings > Members',
                ),
                path: 'members',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/plans'),
                  'Mobile > Workspace > Settings > Plans',
                ),
                path: 'plans',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/billing'),
                  'Mobile > Workspace > Settings > Billing',
                ),
                path: 'billing',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/credits'),
                  'Mobile > Workspace > Settings > Credits',
                ),
                path: 'credits',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/[workspaceSlug]/settings/usage'),
                  'Mobile > Workspace > Settings > Usage',
                ),
                path: 'usage',
              },
            ],
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
  {
    element: dynamicElement(
      () => import('@/routes/onboarding/agent'),
      'Mobile > Onboarding > Agent',
    ),
    errorElement: <ErrorBoundary />,
    path: '/onboarding/agent',
  },
  {
    element: dynamicElement(
      () => import('@/routes/onboarding/classic'),
      'Mobile > Onboarding > Classic',
    ),
    errorElement: <ErrorBoundary />,
    path: '/onboarding/classic',
  },
  ...BusinessMobileRoutesWithoutMainLayout,

  // Share topic route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/share/t/[id]'), 'Mobile > Share > Topic'),
        handle: { meta: shareTopicRouteMeta },
        path: ':id',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/share/t/[id]/_layout'),
      'Mobile > Share > Topic > Layout',
    ),
    path: '/share/t',
  },

  // Share page route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/share/page/[id]'), 'Mobile > Share > Page'),
        path: ':id',
      },
    ],
    path: '/share/page',
  },

  // Messenger verify route (outside main layout)
  {
    element: dynamicElement(() => import('@/routes/verify-im'), 'Mobile > VerifyIm'),
    errorElement: <ErrorBoundary />,
    path: '/verify-im',
  },

  // Standalone verification-report viewer (outside main layout)
  {
    element: dynamicElement(() => import('@/routes/verify/[runId]'), 'Mobile > VerifyReport'),
    errorElement: <ErrorBoundary />,
    handle: { meta: verifyRouteMeta },
    path: '/verify/:runId',
  },
];
