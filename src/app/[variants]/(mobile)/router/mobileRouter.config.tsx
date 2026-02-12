'use client';

import MobileMainLayout from '@/app/[variants]/(mobile)/_layout';
import MobileHome from '@/app/[variants]/(mobile)/(home)/';
import MobileHomeLayout from '@/app/[variants]/(mobile)/(home)/_layout';
import MobileChatLayout from '@/app/[variants]/(mobile)/chat/_layout';
import MobileMeHomeLayout from '@/app/[variants]/(mobile)/me/(home)/layout';
import MobileMeProfileLayout from '@/app/[variants]/(mobile)/me/profile/layout';
import MobileMeSettingsLayout from '@/app/[variants]/(mobile)/me/settings/layout';
import MobileSettingsProviderLayout from '@/app/[variants]/(mobile)/settings/provider/_layout';
import {
  BusinessMobileRoutesWithMainLayout,
  BusinessMobileRoutesWithoutMainLayout,
} from '@/business/client/BusinessMobileRoutes';
import { type RouteConfig } from '@/utils/router';
import { dynamicElement, ErrorBoundary, redirectElement } from '@/utils/router';

import MobileSettingsLayout from '../settings/_layout';

// Mobile router configuration (declarative mode)
export const mobileRoutes: RouteConfig[] = [
  {
    children: [
      // Chat routes
      {
        children: [
          {
            element: redirectElement('/'),
            index: true,
          },
          {
            children: [
              {
                element: dynamicElement(() => import('../chat'), 'Mobile > Chat'),
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('../chat/settings'),
                  'Mobile > Chat > Settings',
                ),
                path: 'settings',
              },
            ],
            element: <MobileChatLayout />,
            errorElement: <ErrorBoundary resetPath="/agent" />,
            path: ':aid',
          },
        ],
        path: 'agent',
      },

      // Discover routes with nested structure
      {
        children: [
          // List routes (with ListLayout)
          {
            children: [
              {
                element: dynamicElement(
                  () => import('../../(main)/community/(list)/(home)'),
                  'Mobile > Discover > List > Home',
                ),
                index: true,
              },
              {
                children: [
                  {
                    element: dynamicElement(
                      () => import('../../(main)/community/(list)/agent'),
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
                      () => import('../../(main)/community/(list)/model'),
                      'Mobile > Discover > List > Model',
                    ),
                    path: 'model',
                  },
                ],
              },
              {
                element: dynamicElement(
                  () => import('../../(main)/community/(list)/provider'),
                  'Mobile > Discover > List > Provider',
                ),
                path: 'provider',
              },
              {
                children: [
                  {
                    element: dynamicElement(
                      () => import('../../(main)/community/(list)/mcp'),
                      'Mobile > Discover > List > MCP',
                    ),
                    path: 'mcp',
                  },
                ],
              },
            ],
            element: dynamicElement(
              () => import('../community/(list)/_layout'),
              'Mobile > Discover > List > Layout',
            ),
          },
          // Detail routes (with DetailLayout)
          {
            children: [
              {
                element: dynamicElement(
                  () =>
                    import('../../(main)/community/(detail)/agent').then(
                      (m) => m.MobileDiscoverAssistantDetailPage,
                    ),
                  'Mobile > Discover > Detail > Agent',
                ),
                path: 'agent/:slug',
              },
              {
                element: dynamicElement(
                  () =>
                    import('../../(main)/community/(detail)/model').then((m) => m.MobileModelPage),
                  'Mobile > Discover > Detail > Model',
                ),
                path: 'model/:slug',
              },
              {
                element: dynamicElement(
                  () =>
                    import('../../(main)/community/(detail)/provider').then(
                      (m) => m.MobileProviderPage,
                    ),
                  'Mobile > Discover > Detail > Provider',
                ),
                path: 'provider/:slug',
              },
              {
                element: dynamicElement(
                  () => import('../../(main)/community/(detail)/mcp').then((m) => m.MobileMcpPage),
                  'Mobile > Discover > Detail > MCP',
                ),
                path: 'mcp/:slug',
              },
              {
                element: dynamicElement(
                  () =>
                    import('../../(main)/community/(detail)/user').then(
                      (m) => m.MobileUserDetailPage,
                    ),
                  'Mobile > Discover > Detail > User',
                ),
                path: 'user/:slug',
              },
            ],
            element: dynamicElement(
              () => import('../community/(detail)/_layout'),
              'Mobile > Discover > Detail > Layout',
            ),
          },
        ],
        element: dynamicElement(() => import('../community/_layout'), 'Mobile > Discover > Layout'),
        errorElement: <ErrorBoundary resetPath="/community" />,
        path: 'community',
      },

      // Settings routes
      {
        children: [
          {
            element: dynamicElement(() => import('../settings'), 'Mobile > Settings'),
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
                  () => import('../../(main)/settings/provider').then((m) => m.ProviderDetailPage),
                  'Mobile > Settings > Provider > Detail',
                ),
                path: ':providerId',
              },
            ],
            element: <MobileSettingsProviderLayout />,
            path: 'provider',
          },
          // Other settings tabs (common, agent, memory, tts, about, etc.)
          {
            element: dynamicElement(
              () => import('../../(main)/settings'),
              'Mobile > Settings > Tab',
            ),
            path: ':tab',
          },
        ],
        element: <MobileSettingsLayout />,
        errorElement: <ErrorBoundary resetPath="/settings" />,
        path: 'settings',
      },

      ...BusinessMobileRoutesWithMainLayout,

      // Me routes (mobile personal center)
      {
        children: [
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/app/[variants]/(mobile)/me/(home)'),
                  'Mobile > Me > Home',
                ),
                index: true,
              },
            ],
            element: <MobileMeHomeLayout />,
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/app/[variants]/(mobile)/me/profile'),
                  'Mobile > Me > Profile',
                ),
                path: 'profile',
              },
            ],
            element: <MobileMeProfileLayout />,
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/app/[variants]/(mobile)/me/settings'),
                  'Mobile > Me > Settings',
                ),
                path: 'settings',
              },
            ],
            element: <MobileMeSettingsLayout />,
          },
        ],
        errorElement: <ErrorBoundary resetPath="/me" />,
        path: 'me',
      },

      // Default route - home page
      {
        children: [
          {
            element: <MobileHome />,
            index: true,
          },
        ],
        element: <MobileHomeLayout />,
      },

      // Catch-all route
      {
        element: redirectElement('/'),
        path: '*',
      },
    ],
    element: <MobileMainLayout />,
    errorElement: <ErrorBoundary resetPath="/" />,
    path: '/',
  },
  // Onboarding route (outside main layout)
  {
    element: dynamicElement(() => import('../../onboarding'), 'Mobile > Onboarding'),
    errorElement: <ErrorBoundary resetPath="/" />,
    path: '/onboarding',
  },
  ...BusinessMobileRoutesWithoutMainLayout,

  // Share topic route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(() => import('../../share/t/[id]'), 'Mobile > Share > Topic'),
        path: ':id',
      },
    ],
    element: dynamicElement(
      () => import('../../share/t/[id]/_layout'),
      'Mobile > Share > Topic > Layout',
    ),
    path: '/share/t',
  },
];
