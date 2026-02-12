'use client';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
} from '@/business/client/BusinessDesktopRoutes';
import { isDesktop } from '@/const/version';
import { type RouteConfig } from '@/utils/router';
import { dynamicElement, ErrorBoundary, redirectElement } from '@/utils/router';

import DesktopOnboarding from '../(desktop)/desktop-onboarding';
import DesktopMainLayout from '../(main)/_layout';
import DesktopChatLayout from '../(main)/agent/_layout';
import DesktopGroupLayout from '../(main)/group/_layout';
import DesktopImageLayout from '../(main)/image/_layout';
import DesktopMemoryLayout from '../(main)/memory/_layout';
import DesktopPageLayout from '../(main)/page/_layout';

// Desktop router configuration (declarative mode)
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
                element: dynamicElement(() => import('../(main)/agent'), 'Desktop > Chat'),
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('../(main)/agent/profile'),
                  'Desktop > Chat > Profile',
                ),
                path: 'profile',
              },
              {
                element: dynamicElement(
                  () => import('../(main)/agent/cron/[cronId]'),
                  'Desktop > Chat > Cron Detail',
                ),
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
                element: dynamicElement(() => import('../(main)/group'), 'Desktop > Agent Group'),
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('../(main)/group/profile'),
                  'Desktop > Agent Group > Profile',
                ),
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
                    element: dynamicElement(
                      () => import('../(main)/community/(list)/agent'),
                      'Desktop > Discover > List > Agent',
                    ),
                    index: true,
                  },
                ],
                element: dynamicElement(
                  () => import('../(main)/community/(list)/agent/_layout'),
                  'Desktop > Discover > List > Agent > Layout',
                ),
                path: 'agent',
              },
              {
                children: [
                  {
                    element: dynamicElement(
                      () => import('../(main)/community/(list)/model'),
                      'Desktop > Discover > List > Model',
                    ),
                    index: true,
                  },
                ],
                element: dynamicElement(
                  () => import('../(main)/community/(list)/model/_layout'),
                  'Desktop > Discover > List > Model > Layout',
                ),
                path: 'model',
              },
              {
                element: dynamicElement(
                  () => import('../(main)/community/(list)/provider'),
                  'Desktop > Discover > List > Provider',
                ),
                path: 'provider',
              },
              {
                children: [
                  {
                    element: dynamicElement(
                      () => import('../(main)/community/(list)/mcp'),
                      'Desktop > Discover > List > MCP',
                    ),
                    index: true,
                  },
                ],
                element: dynamicElement(
                  () => import('../(main)/community/(list)/mcp/_layout'),
                  'Desktop > Discover > List > MCP > Layout',
                ),
                path: 'mcp',
              },
              {
                element: dynamicElement(
                  () => import('../(main)/community/(list)/(home)'),
                  'Desktop > Discover > List > Home',
                ),
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('../(main)/community/(list)/_layout'),
              'Desktop > Discover > List > Layout',
            ),
          },
          // Detail routes (with DetailLayout)
          {
            children: [
              {
                element: dynamicElement(
                  () => import('../(main)/community/(detail)/agent'),
                  'Desktop > Discover > Detail > Agent',
                ),
                path: 'agent/:slug',
              },
              {
                element: dynamicElement(
                  () => import('../(main)/community/(detail)/group_agent'),
                  'Desktop > Discover > Detail > Group Agent',
                ),
                path: 'group_agent/:slug',
              },
              {
                element: dynamicElement(
                  () => import('../(main)/community/(detail)/model'),
                  'Desktop > Discover > Detail > Model',
                ),
                path: 'model/:slug',
              },
              {
                element: dynamicElement(
                  () => import('../(main)/community/(detail)/provider'),
                  'Desktop > Discover > Detail > Provider',
                ),
                path: 'provider/:slug',
              },
              {
                element: dynamicElement(
                  () => import('../(main)/community/(detail)/mcp'),
                  'Desktop > Discover > Detail > MCP',
                ),
                path: 'mcp/:slug',
              },
              {
                element: dynamicElement(
                  () => import('../(main)/community/(detail)/user'),
                  'Desktop > Discover > Detail > User',
                ),
                path: 'user/:slug',
              },
            ],
            element: dynamicElement(
              () => import('../(main)/community/(detail)/_layout'),
              'Desktop > Discover > Detail > Layout',
            ),
          },
        ],
        element: dynamicElement(
          () => import('../(main)/community/_layout'),
          'Desktop > Discover > Layout',
        ),
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
                element: dynamicElement(
                  () => import('../(main)/resource/(home)'),
                  'Desktop > Resource > Home',
                ),
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('../(main)/resource/(home)/_layout'),
              'Desktop > Resource > Home > Layout',
            ),
          },
          // Library routes (knowledge base detail)
          {
            children: [
              {
                element: dynamicElement(
                  () => import('../(main)/resource/library'),
                  'Desktop > Resource > Library',
                ),
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('../(main)/resource/library/[slug]'),
                  'Desktop > Resource > Library > Slug',
                ),
                path: ':slug',
              },
            ],
            element: dynamicElement(
              () => import('../(main)/resource/library/_layout'),
              'Desktop > Resource > Library > Layout',
            ),
            path: 'library/:id',
          },
        ],
        element: dynamicElement(
          () => import('../(main)/resource/_layout'),
          'Desktop > Resource > Layout',
        ),
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
                element: dynamicElement(
                  () => import('../(main)/settings/provider').then((m) => m.ProviderDetailPage),
                  'Desktop > Settings > Provider > Detail',
                ),
                path: ':providerId',
              },
            ],
            element: dynamicElement(
              () => import('../(main)/settings/provider').then((m) => m.ProviderLayout),
              'Desktop > Settings > Provider > Layout',
            ),
            path: 'provider',
          },
          // Other settings tabs
          {
            element: dynamicElement(() => import('../(main)/settings'), 'Desktop > Settings > Tab'),
            path: ':tab',
          },
        ],
        element: dynamicElement(
          () => import('../(main)/settings/_layout'),
          'Desktop > Settings > Layout',
        ),
        errorElement: <ErrorBoundary resetPath="/settings" />,
        path: 'settings',
      },

      // Memory routes
      {
        children: [
          {
            element: dynamicElement(
              () => import('../(main)/memory/(home)'),
              'Desktop > Memory > Home',
            ),
            index: true,
          },
          {
            element: dynamicElement(
              () => import('../(main)/memory/identities'),
              'Desktop > Memory > Identities',
            ),
            path: 'identities',
          },
          {
            element: dynamicElement(
              () => import('../(main)/memory/contexts'),
              'Desktop > Memory > Contexts',
            ),
            path: 'contexts',
          },
          {
            element: dynamicElement(
              () => import('../(main)/memory/preferences'),
              'Desktop > Memory > Preferences',
            ),
            path: 'preferences',
          },
          {
            element: dynamicElement(
              () => import('../(main)/memory/experiences'),
              'Desktop > Memory > Experiences',
            ),
            path: 'experiences',
          },
          {
            element: dynamicElement(
              () => import('../(main)/memory/activities'),
              'Desktop > Memory > Activities',
            ),
            path: 'activities',
          },
        ],
        element: <DesktopMemoryLayout />,
        errorElement: <ErrorBoundary resetPath="/memory" />,
        path: 'memory',
      },

      // Image routes
      {
        children: [
          {
            element: dynamicElement(() => import('../(main)/image'), 'Desktop > Image'),
            index: true,
          },
        ],
        element: <DesktopImageLayout />,
        errorElement: <ErrorBoundary resetPath="/image" />,
        path: 'image',
      },

      ...BusinessDesktopRoutesWithMainLayout,

      // Pages routes
      {
        children: [
          {
            element: dynamicElement(() => import('../(main)/page'), 'Desktop > Page'),
            index: true,
          },
          {
            element: dynamicElement(() => import('../(main)/page/[id]'), 'Desktop > Page > Detail'),
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
  // Onboarding route (outside main layout)

  ...BusinessDesktopRoutesWithoutMainLayout,

  // Share topic route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(() => import('../share/t/[id]'), 'Desktop > Share > Topic'),
        path: ':id',
      },
    ],
    element: dynamicElement(
      () => import('../share/t/[id]/_layout'),
      'Desktop > Share > Topic > Layout',
    ),
    path: '/share/t',
  },
];

// Desktop onboarding route (SPA-only)
if (isDesktop) {
  desktopRoutes.push({
    element: <DesktopOnboarding />,
    errorElement: <ErrorBoundary resetPath="/" />,
    path: '/desktop-onboarding',
  });
} else {
  desktopRoutes.push({
    element: dynamicElement(() => import('../onboarding'), 'Desktop > Onboarding'),
    errorElement: <ErrorBoundary resetPath="/" />,
    path: '/onboarding',
  });
}
