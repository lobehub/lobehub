'use client';

import { type RouteObject } from 'react-router-dom';

import {
  BusinessDesktopRoutesWithMainLayout,
  BusinessDesktopRoutesWithoutMainLayout,
} from '@/business/client/BusinessDesktopRoutes';
import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

const agentChatElement = dynamicElement(() => import('@/routes/(main)/agent'), 'Desktop > Chat');
const isDev = process.env.NODE_ENV === 'development';
// Desktop router configuration (declarative mode)
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
                children: [
                  {
                    element: agentChatElement,
                    index: true,
                  },
                  {
                    children: [
                      {
                        element: agentChatElement,
                        index: true,
                      },
                      {
                        children: [
                          {
                            element: dynamicElement(
                              () => import('@/routes/(main)/agent/[topicId]/page'),
                              'Desktop > Chat > Topic > Page > Redirect',
                            ),
                            index: true,
                          },
                          {
                            element: dynamicElement(
                              () => import('@/routes/(main)/agent/[topicId]/page/[docId]'),
                              'Desktop > Chat > Topic > Page > Doc',
                            ),
                            path: ':docId',
                          },
                        ],
                        path: 'page',
                      },
                    ],
                    path: ':topicId',
                  },
                ],
                element: dynamicLayout(
                  () => import('@/routes/(main)/agent/(chat)/_layout'),
                  'Desktop > Chat > ChatLayout',
                ),
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/agent/page'),
                  'Desktop > Chat > Invalid Page Redirect',
                ),
                path: 'page',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/agent/profile'),
                  'Desktop > Chat > Profile',
                ),
                path: 'profile',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/agent/cron/[cronId]'),
                  'Desktop > Chat > Cron Detail',
                ),
                path: 'cron/:cronId',
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/agent/channel'),
                  'Desktop > Chat > Channel',
                ),
                path: 'channel',
              },
              {
                children: [
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/agent/tasks'),
                      'Desktop > Chat > Tasks',
                    ),
                    index: true,
                  },
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/agent/tasks/[taskId]'),
                      'Desktop > Chat > Task Detail',
                    ),
                    path: ':taskId',
                  },
                ],
                element: dynamicLayout(
                  () => import('@/routes/(main)/agent/tasks/_layout'),
                  'Desktop > Chat > Tasks > Layout',
                ),
                path: 'tasks',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/agent/_layout'),
              'Desktop > Chat > Layout',
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
            element: redirectElement('/'),
            index: true,
          },
          {
            children: [
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/group'),
                  'Desktop > Agent Group',
                ),
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/group/profile'),
                  'Desktop > Agent Group > Profile',
                ),
                path: 'profile',
              },
            ],
            element: dynamicLayout(
              () => import('@/routes/(main)/group/_layout'),
              'Desktop > Group > Layout',
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
                path: 'provider',
              },
              {
                children: [
                  {
                    element: dynamicElement(
                      () => import('@/routes/(main)/community/(list)/skill'),
                      'Desktop > Discover > List > Skill',
                    ),
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
                  () => import('@/routes/(main)/community/(list)/(home)'),
                  'Desktop > Discover > List > Home',
                ),
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(list)/_layout'),
              'Desktop > Discover > List > Layout',
            ),
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
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/community/(detail)/_layout'),
              'Desktop > Discover > Detail > Layout',
            ),
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/community/_layout'),
          'Desktop > Discover > Layout',
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
                ),
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/resource/(home)/_layout'),
              'Desktop > Resource > Home > Layout',
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
                index: true,
              },
              {
                element: dynamicElement(
                  () => import('@/routes/(main)/resource/library/[slug]'),
                  'Desktop > Resource > Library > Slug',
                ),
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
        ),
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
                element: dynamicElement(
                  () =>
                    import('@/routes/(main)/settings/provider').then((m) => m.ProviderDetailPage),
                  'Desktop > Settings > Provider > Detail',
                ),
                path: ':providerId',
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/settings/provider').then((m) => m.ProviderLayout),
              'Desktop > Settings > Provider > Layout',
            ),
            path: 'provider',
          },
          // Other settings tabs
          {
            element: dynamicElement(
              () => import('@/routes/(main)/settings'),
              'Desktop > Settings > Tab',
            ),
            path: ':tab',
          },
        ],
        element: dynamicElement(
          () => import('@/routes/(main)/settings/_layout'),
          'Desktop > Settings > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: 'settings',
      },

      // Memory routes
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/memory/(home)'),
              'Desktop > Memory > Home',
            ),
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/memory/identities'),
              'Desktop > Memory > Identities',
            ),
            path: 'identities',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/memory/contexts'),
              'Desktop > Memory > Contexts',
            ),
            path: 'contexts',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/memory/preferences'),
              'Desktop > Memory > Preferences',
            ),
            path: 'preferences',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/memory/experiences'),
              'Desktop > Memory > Experiences',
            ),
            path: 'experiences',
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/memory/activities'),
              'Desktop > Memory > Activities',
            ),
            path: 'activities',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/memory/_layout'),
          'Desktop > Memory > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: 'memory',
      },

      // Video routes
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/(create)/video'),
              'Desktop > Video',
            ),
            index: true,
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/(create)/video/_layout'),
          'Desktop > Video > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: 'video',
      },

      // Image routes
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/(create)/image'),
              'Desktop > Image',
            ),
            index: true,
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/(create)/image/_layout'),
          'Desktop > Image > Layout',
        ),
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
                element: dynamicElement(
                  () => import('@/routes/(main)/eval'),
                  'Desktop > Eval > Overview',
                ),
                index: true,
              },
            ],
            element: dynamicElement(
              () => import('@/routes/(main)/eval/(home)/_layout'),
              'Desktop > Eval > Home > Layout',
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
        ),
        errorElement: <ErrorBoundary />,
        path: 'eval',
      },

      // Tasks routes (cross-agent)
      {
        children: [
          {
            element: dynamicElement(() => import('@/routes/(main)/tasks'), 'Desktop > Tasks'),
            index: true,
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/tasks/_layout'),
          'Desktop > Tasks > Layout',
        ),
        errorElement: <ErrorBoundary resetPath="/" />,
        path: 'tasks',
      },

      // Task detail route (cross-agent entry — resolves by task identifier)
      {
        children: [
          {
            element: dynamicElement(
              () => import('@/routes/(main)/task/[taskId]'),
              'Desktop > Task Detail',
            ),
            path: ':taskId',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/task/_layout'),
          'Desktop > Task > Layout',
        ),
        errorElement: <ErrorBoundary resetPath="/tasks" />,
        path: 'task',
      },

      // Pages routes
      {
        children: [
          {
            element: dynamicElement(() => import('@/routes/(main)/page'), 'Desktop > Page'),
            index: true,
          },
          {
            element: dynamicElement(
              () => import('@/routes/(main)/page/[id]'),
              'Desktop > Page > Detail',
            ),
            path: ':id',
          },
        ],
        element: dynamicLayout(
          () => import('@/routes/(main)/page/_layout'),
          'Desktop > Page > Layout',
        ),
        errorElement: <ErrorBoundary />,
        path: 'page',
      },

      ...(isDev
        ? [
            {
              element: dynamicElement(
                () => import('@/routes/(main)/devtools'),
                'Desktop > Devtools',
              ),
              path: 'devtools',
            },
          ]
        : []),

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
    element: dynamicLayout(() => import('@/routes/(main)/_layout'), 'Desktop > Main > Layout'),
    errorElement: <ErrorBoundary />,
    path: '/',
  },
  // Onboarding route (outside main layout)

  ...BusinessDesktopRoutesWithoutMainLayout,

  // Share topic route (outside main layout)
  {
    children: [
      {
        element: dynamicElement(() => import('@/routes/share/t/[id]'), 'Desktop > Share > Topic'),
        path: ':id',
      },
    ],
    element: dynamicElement(
      () => import('@/routes/share/t/[id]/_layout'),
      'Desktop > Share > Topic > Layout',
    ),
    path: '/share/t',
  },
];

desktopRoutes.push({
  element: dynamicElement(() => import('@/routes/onboarding'), 'Desktop > Onboarding'),
  errorElement: <ErrorBoundary />,
  path: '/onboarding',
});

desktopRoutes.push({
  element: dynamicElement(
    () => import('@/routes/onboarding/agent'),
    'Desktop > Onboarding > Agent',
  ),
  errorElement: <ErrorBoundary />,
  path: '/onboarding/agent',
});

desktopRoutes.push({
  element: dynamicElement(
    () => import('@/routes/onboarding/classic'),
    'Desktop > Onboarding > Classic',
  ),
  errorElement: <ErrorBoundary />,
  path: '/onboarding/classic',
});
