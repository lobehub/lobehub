import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router';
import { matchRoutes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import AppsSkeleton from '@/components/Skeleton/Apps';
import ConversationLayoutSkeleton from '@/components/Skeleton/Conversation/Layout';
import ConversationSegmentSkeleton from '@/components/Skeleton/Conversation/Segment';
import DelayedFallback from '@/components/Skeleton/Delayed';
import GoalSkeleton from '@/components/Skeleton/Goal';
import GoalDetailSkeleton from '@/components/Skeleton/GoalDetail';
import MemorySkeleton from '@/components/Skeleton/Memory';
import ProfileSkeleton, { GroupProfileRouteSkeleton } from '@/components/Skeleton/Profile';
import ResourceHomeSkeleton from '@/components/Skeleton/ResourceHome';
import RouteSegmentSkeleton from '@/components/Skeleton/RouteSegment';
import SettingsPageSkeleton from '@/components/Skeleton/Settings/Page';
import TasksSkeleton from '@/components/Skeleton/Tasks';
import TopicsSkeleton from '@/components/Skeleton/Topics';
import { WORKSPACE_SETTINGS_TABS } from '@/features/Workspace/workspaceAwarePath';
import AppShellSkeleton from '@/spa/BootShell/AppShellSkeleton';
import { createTabRouter } from '@/spa/router/tabRouter';
import { resolveRouteSkeleton } from '@/spa/router/useRouteSkeleton';

import {
  createMainAreaChildren as createWebMainAreaChildren,
  desktopRoutes as webDesktopRoutes,
} from './desktopRouter.config';
import {
  createMainAreaChildren as createElectronMainAreaChildren,
  desktopRoutes as electronDesktopRoutes,
} from './desktopRouter.config.desktop';
import { createMainAreaRouteFactory, ResourceCategorySkeleton } from './desktopRouter.shared';

type MainAreaFactory = () => RouteObject[];

const mainAreaVariants: Array<[string, MainAreaFactory]> = [
  ['Web', createWebMainAreaChildren],
  ['Electron', createElectronMainAreaChildren],
];

const createMainAreaRoutes = (factory: MainAreaFactory): RouteObject[] => [
  { children: factory(), path: '/' },
];

const findWorkspaceSettingsRoute = (factory: MainAreaFactory) => {
  const workspaceRoute = factory().find((route) => route.path === ':workspaceSlug');
  return workspaceRoute?.children?.find((route) => route.path === 'settings');
};

const collectPaths = (routes: RouteObject[]): string[] =>
  routes.flatMap((route) =>
    route.path
      ? [route.path, ...collectPaths(route.children ?? [])]
      : collectPaths(route.children ?? []),
  );

const routeShape = (routes: RouteObject[]): unknown =>
  routes.map((route) => ({
    children: route.children ? routeShape(route.children) : undefined,
    index: route.index === true || undefined,
    path: route.path,
  }));

async function readRouterSources() {
  return Promise.all(
    [
      'desktopRouter.shared.tsx',
      'desktopRouter.config.tsx',
      'desktopRouter.config.desktop.tsx',
    ].map((filename) => readFile(path.join(process.cwd(), 'src/spa/router', filename), 'utf8')),
  );
}

describe('desktop router shared definition', () => {
  it('defers platform route factories until React renders their route elements', () => {
    const createHomeElement = vi.fn(() => <div>Home</div>);
    const createWorkspaceSettingsIndexElement = vi.fn(() => <div>Workspace settings</div>);
    const createRoutes = createMainAreaRouteFactory({
      createHomeElement,
      createWorkspaceSettingsIndexElement,
    });
    const routes = createRoutes();

    expect(createHomeElement).not.toHaveBeenCalled();
    expect(createWorkspaceSettingsIndexElement).not.toHaveBeenCalled();

    const rootHome = routes.find((route) => route.index);
    const workspace = routes.find((route) => route.path === ':workspaceSlug');
    const workspaceHome = workspace?.children?.find((route) => route.index);
    const workspaceSettings = workspace?.children?.find((route) => route.path === 'settings');
    const workspaceSettingsIndex = workspaceSettings?.children?.find((route) => route.index);

    expect((rootHome?.element as ReactElement).type).toBe(createHomeElement);
    expect((workspaceHome?.element as ReactElement).type).toBe(createHomeElement);
    expect((workspaceSettingsIndex?.element as ReactElement).type).toBe(
      createWorkspaceSettingsIndexElement,
    );
  });

  it.each(mainAreaVariants)(
    '%s agent sub-pages declare route meta so tab titles are not bare branding',
    (_, createMainAreaChildren) => {
      for (const pathname of [
        '/agent/agent-1/profile',
        '/agent/agent-1/channel',
        '/agent/agent-1/channel/slack',
        '/agent/agent-1/statistics',
        '/agent/agent-1/share',
        '/group/group-1/profile',
      ]) {
        const matches = matchRoutes(createMainAreaRoutes(createMainAreaChildren), pathname);
        const meta = matches
          ?.map((match) => (match.route.handle as { meta?: unknown } | undefined)?.meta)
          .findLast(Boolean);

        expect(matches, `${pathname} must match a route`).toBeTruthy();
        expect(meta, `${pathname} must declare handle.meta`).toBeDefined();
      }
    },
  );

  it.each(mainAreaVariants)('%s keeps legacy agent stats deep-links matching', (_, factory) => {
    const matches = matchRoutes(createMainAreaRoutes(factory), '/agent/agent-1/stats');

    expect(matches?.at(-1)?.route.path).toBe('stats');
  });

  it.each(mainAreaVariants)(
    '%s serves the self-learning experience list and redirects legacy /rules links to it',
    (_, factory) => {
      const routes = createMainAreaRoutes(factory);
      const listMatches = matchRoutes(routes, '/agent/agent-1/self-evolving/domain-1/experience');
      const lessonMatches = matchRoutes(
        routes,
        '/agent/agent-1/self-evolving/domain-1/experience/lesson-1',
      );
      const rulesMatches = matchRoutes(routes, '/agent/agent-1/self-evolving/domain-1/rules');
      const legacyLessonMatches = matchRoutes(
        routes,
        '/agent/agent-1/self-evolving/domain-1/rules/lesson-1',
      );

      expect(listMatches?.at(-1)?.route.path).toBe('experience');
      expect(listMatches?.at(-1)?.route.handle).toMatchObject({ meta: expect.any(Object) });
      expect(lessonMatches?.at(-1)?.route.path).toBe('experience/:lessonId');
      expect(lessonMatches?.at(-1)?.params).toMatchObject({
        domainId: 'domain-1',
        lessonId: 'lesson-1',
      });
      // Legacy deep-links: `/rules` redirects relative to the domain route, i.e. to
      // `/self-evolving/:domainId/experience`; `/rules/:lessonId` keeps its own redirect page.
      expect(rulesMatches?.at(-1)?.route.path).toBe('rules');
      expect(
        (rulesMatches?.at(-1)?.route.element as ReactElement<{ to: string }> | undefined)?.props.to,
      ).toBe('../experience');
      expect(rulesMatches?.at(-2)?.pathname).toBe('/agent/agent-1/self-evolving/domain-1');
      expect(legacyLessonMatches?.at(-1)?.route.path).toBe('rules/:lessonId');
    },
  );

  it.each(mainAreaVariants)(
    '%s serves self-learning creation as a dedicated page',
    (_, factory) => {
      const matches = matchRoutes(
        createMainAreaRoutes(factory),
        '/agent/agent-1/self-evolving/new',
      );

      expect(matches?.at(-1)?.route.path).toBe('self-evolving/new');
      expect(matches?.at(-1)?.route.handle).toMatchObject({ meta: expect.any(Object) });
      expect(matches?.at(-1)?.params).not.toHaveProperty('domainId');
    },
  );

  it.each(mainAreaVariants)('%s keeps legacy self-learning deep-links matching', (_, factory) => {
    const matches = matchRoutes(
      createMainAreaRoutes(factory),
      '/agent/agent-1/self-learning/domain-1/experience/lesson-1',
    );

    expect(matches?.at(-1)?.route.path).toBe('self-learning/*');
    expect(matches?.at(-1)?.params['*']).toBe('domain-1/experience/lesson-1');
  });

  it.each(mainAreaVariants)(
    '%s exposes project task, goal, and acceptance workspaces',
    (_, factory) => {
      const projectRoute = factory().find((route) => route.path === 'project/:projectId');
      const projectIndexRoute = projectRoute?.children?.find((route) => route.index);
      const projectPaths = projectRoute?.children
        ?.map((route) => route.path)
        .filter((routePath): routePath is string => Boolean(routePath));

      expect(projectPaths).toEqual(['tasks', 'goals', 'acceptance']);
      expect(
        (projectIndexRoute?.element as ReactElement<{ to: string }> | undefined)?.props.to,
      ).toBe('tasks');
    },
  );

  it.each(mainAreaVariants)('%s exposes the projects view-all route', (_, factory) => {
    const personalMatches = matchRoutes(createMainAreaRoutes(factory), '/projects');
    const workspaceMatches = matchRoutes(createMainAreaRoutes(factory), '/acme/projects');

    expect(personalMatches?.at(-1)?.route.index).toBe(true);
    expect(personalMatches?.at(-1)?.route.handle).toMatchObject({ meta: expect.any(Object) });
    expect(workspaceMatches?.at(-1)?.route.index).toBe(true);
    expect(workspaceMatches?.at(-1)?.route.handle).toMatchObject({ meta: expect.any(Object) });
  });

  it.each(mainAreaVariants)(
    '%s personal memory settings are not shadowed by workspace memory routes',
    (_, factory) => {
      const matches = matchRoutes(createMainAreaRoutes(factory), '/settings/memory');
      const paths = matches?.map((match) => match.route.path);

      expect(paths).toContain('settings');
      expect(paths).not.toContain(':workspaceSlug');
      expect(paths?.at(-1)).toBe('memory');
      expect(matches?.at(-1)?.route.handle).toMatchObject({ settingsTab: 'memory' });
    },
  );

  it('generates identical main-area path and nesting behavior for Web and Electron', () => {
    expect(routeShape(createElectronMainAreaChildren())).toEqual(
      routeShape(createWebMainAreaChildren()),
    );
  });

  it('keeps all route modules behind lazy import boundaries', async () => {
    const sources = await readRouterSources();
    const combinedSource = sources.join('\n');
    const eagerDefaultRouteImports = [
      ...combinedSource.matchAll(/^import\s+[A-Z]\w*\s+from\s+'@\/routes\//gm),
    ];
    const lazyRouteImports = [
      ...combinedSource.matchAll(
        /(?:dynamicElement|dynamicLayout)\(\s*\(\) => (?:loadRouteWithBuiltinToolSurfaces\(\(\) => )?import\(['"]@\/routes\//g,
      ),
    ];

    expect(eagerDefaultRouteImports).toHaveLength(0);
    expect(combinedSource).not.toContain(
      "import { ProviderDetailPage, ProviderLayout } from '@/routes/(main)/settings/provider'",
    );
    expect(lazyRouteImports.length).toBeGreaterThan(100);
  });

  it('owns prioritized preload registration only in the shared route definition', async () => {
    const [sharedSource, webSource, electronSource] = await readRouterSources();

    expect([...sharedSource.matchAll(/preloadId:\s*'[^']+'/g)].length).toBeGreaterThan(0);
    expect(webSource).not.toContain('preloadId:');
    expect(electronSource).not.toContain('preloadId:');
  });

  it('does not opt Electron out of the post-render route preload scheduler', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'src/spa/initialize/routePreload.ts'),
      'utf8',
    );

    expect(source).not.toContain("typeof window === 'undefined' || __ELECTRON__");
  });

  it('keeps platform differences limited to root composition and runtime-only routes', () => {
    const webRoot = webDesktopRoutes.find((route) => route.path === '/');
    const electronRoot = electronDesktopRoutes.find((route) => route.path === '/');
    const webPaths = webDesktopRoutes.map((route) => route.path);
    const electronPaths = electronDesktopRoutes.map((route) => route.path);

    expect(webRoot?.children).toHaveLength(createWebMainAreaChildren().length);
    expect(electronRoot?.children).toMatchObject([
      { element: null, index: true },
      { element: null, path: '*' },
    ]);
    expect(webPaths).toContain('/verify-im');
    // `/share/*` moved to the standalone Share app (apps/share).
    expect(webPaths).not.toContain('/share/t');
    expect(webPaths).not.toContain('/share/page');
    // …and the agent-share visitor surface moved to `/agent/:aid`, so the old
    // pattern stays registered on every platform only to redirect legacy links
    // (Web, Electron, and the mobile router — see mobileRouter.test.tsx).
    expect(webPaths).toContain('/share/agent/:slugOrId');
    expect(electronPaths).toContain('/share/agent/:slugOrId');
    expect(webPaths).not.toContain('/verify');
    expect(webPaths).toContain('/acceptance');
    expect(webPaths).toContain('/onboarding');
    expect(webPaths).not.toContain('/desktop-onboarding');
    expect(electronPaths).not.toContain('/verify-im');
    expect(electronPaths).not.toContain('/share/t');
    expect(electronPaths).not.toContain('/share/page');
    expect(electronPaths).not.toContain('/verify');
    expect(electronPaths).not.toContain('/acceptance');
    expect(electronPaths).not.toContain('/onboarding');
    expect(electronPaths).toContain('/desktop-onboarding');
  });

  it.each([
    ['Web', webDesktopRoutes],
    ['Electron', electronDesktopRoutes],
  ])('%s hands the boot shell over to the same skeleton, not the brand logo', (_, routes) => {
    const root = routes.find((route) => route.path === '/');
    const { fallback } = (root?.element as ReactElement<{ fallback: ReactElement }>).props;

    expect(fallback.type).toBe(AppShellSkeleton);
  });

  // `dynamicElement` / `dynamicLayout` wrap each route element in their own
  // Suspense, which always beats an outlet-level boundary — so without the
  // rewrite the brand wordmark reappears inside the container for 1–2s on a
  // cold deep link, right after the boot shell hands over.
  // Page-level fallbacks sit behind the 200ms gate, so the skeleton under test
  // is the gate's child rather than the fallback element itself.
  const fallbackType = (fallback?: ReactElement): unknown => {
    if (!fallback) return undefined;
    if (fallback.type !== DelayedFallback) return fallback.type;

    return (fallback.props as { children: ReactElement }).children.type;
  };

  const collectFallbacks = (list: RouteObject[]): unknown[] => {
    const fallbacks: unknown[] = [];
    const walk = (routes: RouteObject[]) => {
      for (const route of routes) {
        const element = route.element as ReactElement<{ fallback?: ReactElement }> | undefined;
        if (element?.props?.fallback) fallbacks.push(fallbackType(element.props.fallback));
        if (route.children) walk(route.children);
      }
    };
    walk(list);
    return fallbacks;
  };

  it.each([
    // Electron's root tree holds only TabHost stubs — its real content routes
    // live in the per-tab memory routers, which build their own tree.
    ['Web', () => webDesktopRoutes.find((route) => route.path === '/')?.children ?? []],
    ['Electron', () => createTabRouter('/').routes[0]?.children ?? []],
  ])(
    '%s main-area routes load behind content or segment feedback, not branding',
    (_, getRoutes) => {
      const fallbacks = collectFallbacks(getRoutes());

      expect(fallbacks.length).toBeGreaterThan(0);
      expect(fallbacks).not.toContain(BrandTextLoading);
      expect(new Set(fallbacks)).toEqual(
        new Set([ConversationLayoutSkeleton, ConversationSegmentSkeleton, RouteSegmentSkeleton]),
      );
    },
  );

  it.each([
    ['Web', (_pathname: string) => webDesktopRoutes],
    ['Electron', (pathname: string) => createTabRouter(pathname).routes],
  ])(
    '%s selects the closest conversation segment feedback for each pending boundary',
    (_, createRuntimeRoutes) => {
      for (const [pathname, expectedFallbacks] of [
        [
          '/agent/agent-1/topic-1',
          [RouteSegmentSkeleton, ConversationLayoutSkeleton, ConversationSegmentSkeleton],
        ],
        ['/group/group-1/topic-1', [RouteSegmentSkeleton, ConversationLayoutSkeleton]],
      ] as const) {
        const matches = matchRoutes(createRuntimeRoutes(pathname), pathname);
        const fallbackTypes = matches
          ?.map(({ route }) =>
            fallbackType(
              (route.element as ReactElement<{ fallback?: ReactElement }> | undefined)?.props
                .fallback,
            ),
          )
          .filter(Boolean);

        expect(fallbackTypes?.slice(-expectedFallbacks.length), pathname).toEqual(
          expectedFallbacks,
        );
      }
    },
  );

  it.each([
    ['Web', (_pathname: string) => webDesktopRoutes],
    ['Electron', (pathname: string) => createTabRouter(pathname).routes],
  ])('%s resolves specialized skeletons from the deepest route meta', (_, getRoutes) => {
    for (const [pathname, expectedSkeleton] of [
      ['/agent/agent-1/topics', TopicsSkeleton],
      ['/agent/agent-1/tasks', TasksSkeleton],
      ['/agent/agent-1/goals', GoalSkeleton],
      ['/agent/agent-1/goal/goal-1', GoalDetailSkeleton],
      ['/agent/agent-1/profile', ProfileSkeleton],
      ['/agent/agent-1/topic-1', ConversationLayoutSkeleton],
      ['/group/group-1/profile', GroupProfileRouteSkeleton],
      ['/group/group-1/topic-1', ConversationLayoutSkeleton],
      ['/settings/profile', SettingsPageSkeleton],
      ['/apps', AppsSkeleton],
      ['/memory', MemorySkeleton],
      ['/resource', ResourceHomeSkeleton],
      ['/resource/files', ResourceCategorySkeleton],
      ['/resource/images', ResourceCategorySkeleton],
      ['/resource/works', ResourceCategorySkeleton],
    ] as const) {
      const matches = matchRoutes(getRoutes(pathname), pathname);
      expect(
        resolveRouteSkeleton(matches?.map(({ route }) => ({ handle: route.handle })) ?? []),
        pathname,
      ).toBe(expectedSkeleton);
    }
  });

  it.each([
    ['Web', (_pathname: string) => webDesktopRoutes],
    ['Electron', (pathname: string) => createTabRouter(pathname).routes],
  ])(
    '%s keeps the settings layout and tab chunks on the settings page skeleton',
    (_, getRoutes) => {
      const matches = matchRoutes(getRoutes('/settings/profile'), '/settings/profile');
      const fallbackTypes = matches
        ?.map(
          ({ route }) =>
            (route.element as ReactElement<{ fallback?: ReactElement }> | undefined)?.props.fallback
              ?.type,
        )
        .filter(Boolean);

      expect(fallbackTypes?.slice(-2)).toEqual([RouteSegmentSkeleton, RouteSegmentSkeleton]);
    },
  );

  it.each([
    ['Web', (_pathname: string) => webDesktopRoutes],
    ['Electron', (pathname: string) => createTabRouter(pathname).routes],
  ])('%s keeps /apps on the route-segment fallback', (_, getRoutes) => {
    const matches = matchRoutes(getRoutes('/apps'), '/apps');
    const fallbackTypes = matches
      ?.map(
        ({ route }) =>
          (route.element as ReactElement<{ fallback?: ReactElement }> | undefined)?.props.fallback
            ?.type,
      )
      .filter(Boolean);

    expect(fallbackTypes?.at(-1)).toBe(RouteSegmentSkeleton);
  });

  it('injects Home only into Electron per-tab content routes', () => {
    const webChildren = createWebMainAreaChildren();
    const electronChildren = createElectronMainAreaChildren();
    const webWorkspace = webChildren.find((route) => route.path === ':workspaceSlug');
    const electronWorkspace = electronChildren.find((route) => route.path === ':workspaceSlug');

    expect(webChildren.find((route) => route.index)?.element).toBeUndefined();
    expect(webWorkspace?.children?.find((route) => route.index)?.element).toBeUndefined();
    expect(electronChildren.find((route) => route.index)?.element).toBeDefined();
    expect(electronWorkspace?.children?.find((route) => route.index)?.element).toBeDefined();
  });

  it.each(mainAreaVariants)(
    '%s registers every workspace-aware settings tab',
    (_, createMainAreaChildren) => {
      const settingsRoute = findWorkspaceSettingsRoute(createMainAreaChildren);
      const registeredTabs = [
        ...new Set(
          collectPaths(settingsRoute?.children ?? []).map(
            (registeredPath) => registeredPath.split('/')[0],
          ),
        ),
      ].sort();

      expect(settingsRoute, 'Workspace settings route must exist').toBeDefined();
      expect(registeredTabs).toEqual([...WORKSPACE_SETTINGS_TABS].sort());
    },
  );

  it.each(mainAreaVariants)(
    '%s keeps workspace provider deep-links inside the workspace',
    (_, factory) => {
      const routes = createMainAreaRoutes(factory);
      const listMatches = matchRoutes(routes, '/acme/settings/provider');
      const detailMatches = matchRoutes(routes, '/acme/settings/provider/lobehub');

      expect(listMatches?.at(-1)?.route.path).toBe('provider');
      // Before the redirect route existed, the detail path fell through to the
      // root catch-all (`*`) and kicked the user out of the workspace.
      expect(detailMatches?.at(-1)?.route.path).toBe('provider/:providerId');
      expect(detailMatches?.at(-1)?.params).toMatchObject({
        providerId: 'lobehub',
        workspaceSlug: 'acme',
      });
    },
  );

  it.each(mainAreaVariants)(
    '%s registers workspace OAuth app list and detail routes',
    (_, factory) => {
      const routes = createMainAreaRoutes(factory);
      const listMatches = matchRoutes(routes, '/acme/settings/oauth-apps');
      const detailMatches = matchRoutes(routes, '/acme/settings/oauth-apps/client-1');

      expect(listMatches?.at(-1)?.route.path).toBe('oauth-apps');
      expect(detailMatches?.at(-1)?.route.path).toBe('oauth-apps/:sub');
      expect(detailMatches?.at(-1)?.params).toMatchObject({
        sub: 'client-1',
        workspaceSlug: 'acme',
      });
    },
  );

  it.each(mainAreaVariants)(
    '%s keeps serving the creator agent surface on /agent/:aid',
    (_, factory) => {
      const matches = matchRoutes(createMainAreaRoutes(factory), '/agent/agt_1');

      // The agent-share visitor page now shares this route; the branch is
      // decided by `AgentRouteSwitch`, not by a second route pattern.
      expect(matches?.some((match) => match.route.path === ':aid')).toBe(true);
      expect(matches?.at(-1)?.params).toMatchObject({ aid: 'agt_1' });
    },
  );

  it.each([
    ['Web', webDesktopRoutes],
    ['Electron', electronDesktopRoutes],
  ])('%s redirects legacy /share/agent links to /agent', (_, routes) => {
    const matches = matchRoutes(routes, '/share/agent/my-bot');
    const element = matches?.at(-1)?.route.element as ReactElement;

    expect(matches?.at(-1)?.params).toMatchObject({ slugOrId: 'my-bot' });
    expect((element.type as { displayName?: string }).displayName).toBe('AgentShareLegacyRedirect');
  });

  it('keeps business resource and task routes in the shared definition', async () => {
    const [sharedSource] = await readRouterSources();

    expect(sharedSource).toContain('...BusinessResourceRoutes');
    expect(sharedSource).toContain("import('@/routes/(main)/(task-workspace)/_layout')");
    expect(sharedSource).toContain("import('@/routes/(main)/agent/task/[taskId]')");
    expect(sharedSource).not.toContain("import('@/routes/(main)/task-workspace/_layout')");
    expect(sharedSource).not.toContain("import('@/routes/(main)/tasks/_layout')");
    expect(sharedSource).not.toContain("import('@/routes/(main)/task/_layout')");
  });
});
