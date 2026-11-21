'use client';

import { Blocks, ShapesIcon } from 'lucide-react';
import { lazy } from 'react';
import { type RouteObject, useParams, useSearchParams } from 'react-router';

import CommunityListSkeleton from '@/components/Skeleton/CommunityList';
import { MarketplaceCatalogSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import {
  getLegacyConnectorCatalogPath,
  getMarketplaceEntryPath,
  LEGACY_COMMUNITY_SEGMENT,
  MARKETPLACE_APPS_PATH,
  MARKETPLACE_INSTALLED_CONNECTORS_PATH,
  MARKETPLACE_INSTALLED_SKILLS_PATH,
  MARKETPLACE_SEGMENT,
  marketplaceAppPath,
} from '@/features/Marketplace/paths';
import {
  marketplaceConnectorsRouteMeta,
  marketplaceInstalledSkillsRouteMeta,
} from '@/features/Marketplace/routeMeta';
import { SUPPORTED_MESSENGER_PLATFORMS } from '@/features/Messenger/platforms';
import { communityDetailRouteMeta } from '@/features/RouteMeta/communityRouteMeta';
import {
  LegacyCommunityRedirect,
  LegacyIntegrationRedirect,
  LegacyPathRedirect,
} from '@/spa/router/legacyPathRedirect';
import { routeMeta } from '@/spa/router/routeMeta';
import { useServerConfigStore } from '@/store/serverConfig';
import { dynamicElement, ErrorBoundary } from '@/utils/router';

/**
 * Management pages moved here from settings (installed skills, connectors).
 * They sit beside the list and detail layouts, not inside them: no store search
 * bar, category column or market sign-in footer; the page draws its own header.
 * `skill/installed` is static, so it outranks the `skill/:slug` detail route.
 * Mobile reuses these with a shell header (`mobileRouter.config.tsx`).
 */
export const marketplaceManageRoutes: RouteObject[] = [
  {
    element: dynamicElement(
      () => import('@/routes/(main)/community/(manage)/mcp'),
      'Marketplace > Installed MCP',
    ),
    handle: {
      meta: routeMeta({
        icon: Blocks,
        Skeleton: MarketplaceCatalogSkeleton,
        titleKey: 'navigation.marketplaceMcp',
      }),
    },
    path: 'mcp/installed',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/community/(manage)/skill-installed'),
      'Desktop > Marketplace > Installed Skills',
      { preloadId: 'community' },
    ),
    handle: { meta: marketplaceInstalledSkillsRouteMeta },
    path: 'skill/installed',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/community/(manage)/connector'),
      'Desktop > Marketplace > Connectors',
      { preloadId: 'community' },
    ),
    handle: { meta: marketplaceConnectorsRouteMeta },
    path: 'connector/installed',
  },
];

/**
 * Marks a route that only redirects (it never paints, so it needs no title or
 * skeleton); the route title and DynamicMeta checks skip it.
 */
export const LEGACY_REDIRECT_HANDLE = { legacyRedirect: true } as const;

const MarketplaceEntryRedirect = () => {
  const destination = useServerConfigStore((s) =>
    s.serverConfigInit ? getMarketplaceEntryPath(s.featureFlags.showMarket) : undefined,
  );

  return destination ? <LegacyPathRedirect to={destination} /> : null;
};

export const marketplaceIndexRoute: RouteObject = {
  element: <MarketplaceEntryRedirect />,
  handle: LEGACY_REDIRECT_HANDLE,
  index: true,
};

const LegacyConnectorCatalog = () => {
  const [params] = useSearchParams();
  return <LegacyPathRedirect to={getLegacyConnectorCatalogPath(params)} />;
};

export const legacyConnectorCatalogRoute: RouteObject = {
  element: <LegacyConnectorCatalog />,
  handle: LEGACY_REDIRECT_HANDLE,
  path: 'connector',
};

export const marketplaceAppAndMcpRoutes: RouteObject[] = [
  {
    element: dynamicElement(
      () => import('@/routes/(main)/community/(list)/app'),
      'Marketplace > Apps',
    ),
    handle: {
      meta: routeMeta({
        icon: Blocks,
        Skeleton: MarketplaceCatalogSkeleton,
        titleKey: 'navigation.marketplaceApps',
      }),
    },
    path: 'app',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/community/(detail)/app'),
      'Marketplace > App detail',
    ),
    handle: {
      meta: routeMeta({
        DynamicMeta: lazy(() => import('@/features/Marketplace/Apps/AppDynamicMeta')),
        icon: Blocks,
        Skeleton: createSurfaceSkeleton('detail'),
        titleKey: 'navigation.marketplaceApps',
      }),
    },
    path: 'app/:appId',
  },
  {
    element: dynamicElement(
      () => import('@/routes/(main)/community/(list)/mcp'),
      'Marketplace > MCP',
    ),
    handle: {
      meta: routeMeta({
        icon: Blocks,
        Skeleton: MarketplaceCatalogSkeleton,
        titleKey: 'navigation.marketplaceMcp',
      }),
    },
    path: 'mcp',
  },
];

/**
 * `/marketplace/*` (and `/:workspaceSlug/marketplace/*`), formerly `/community`.
 * Shared by Web and Electron through `sharedMainAreaChildren`. The route id,
 * preload group and `(main)/community` folder keep the old name; only the URL moved.
 */
export const marketplaceRoute: RouteObject = {
  children: [
    {
      element: dynamicElement(
        () => import('@/routes/(main)/community/(detail)/workspace/settings'),
        'Desktop > Discover > Workspace > Settings',
      ),
      handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('form') }) },
      path: 'workspace/settings',
    },
    marketplaceIndexRoute,
    ...marketplaceManageRoutes,
    legacyConnectorCatalogRoute,
    // List routes (with ListLayout)
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
              Skeleton: MarketplaceCatalogSkeleton,
              titleKey: 'navigation.marketplaceAgents',
            }),
          },
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
                meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.marketplaceModels' }),
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
            meta: routeMeta({ icon: ShapesIcon, titleKey: 'navigation.marketplaceProviders' }),
          },
          path: 'provider',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(list)/skill'),
            'Desktop > Discover > List > Skill',
          ),
          handle: {
            meta: routeMeta({
              icon: ShapesIcon,
              Skeleton: MarketplaceCatalogSkeleton,
              titleKey: 'navigation.marketplaceSkills',
            }),
          },
          path: 'skill',
        },
        ...marketplaceAppAndMcpRoutes,
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/workspace'),
            'Desktop > Discover > List > Workspace',
          ),
          handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('detail') }) },
          path: 'workspace',
        },
      ],
      element: dynamicElement(
        () => import('@/routes/(main)/community/(list)/_layout'),
        'Desktop > Discover > List > Layout',
        { preloadId: 'community' },
      ),
      handle: { meta: routeMeta({ Skeleton: CommunityListSkeleton }) },
    },
    // Detail routes (with DetailLayout)
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/agent'),
            'Desktop > Discover > Detail > Agent',
          ),
          handle: { meta: communityDetailRouteMeta.agent },
          path: 'agent/:slug',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/group_agent'),
            'Desktop > Discover > Detail > Group Agent',
          ),
          handle: { meta: communityDetailRouteMeta.groupAgent },
          path: 'group_agent/:slug',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/model'),
            'Desktop > Discover > Detail > Model',
          ),
          handle: { meta: communityDetailRouteMeta.model },
          path: 'model/:slug',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/provider'),
            'Desktop > Discover > Detail > Provider',
          ),
          handle: { meta: communityDetailRouteMeta.provider },
          path: 'provider/:slug',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/skill'),
            'Desktop > Discover > Detail > Skill',
          ),
          handle: { meta: communityDetailRouteMeta.skill },
          path: 'skill/:slug',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/mcp'),
            'Desktop > Discover > Detail > MCP',
          ),
          handle: { meta: communityDetailRouteMeta.mcp },
          path: 'mcp/:slug',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/user'),
            'Desktop > Discover > Detail > User',
          ),
          handle: { meta: communityDetailRouteMeta.user },
          path: 'user/:slug',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/community/(detail)/organization'),
            'Desktop > Discover > Detail > Organization',
          ),
          handle: { meta: communityDetailRouteMeta.user },
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
  path: MARKETPLACE_SEGMENT,
};

/** Sub-pages the old Community URLs had (`/community/<type>[/:slug]`). */
const LEGACY_COMMUNITY_SECTIONS = [
  'agent',
  'connector',
  'group_agent',
  'mcp',
  'model',
  'org',
  'plugin',
  'provider',
  'skill',
  'user',
  'workspace',
] as const;

/**
 * Old `/community[/<rest>]` URLs (bookmarks, persisted Electron tabs, external
 * links) forward to `/marketplace[/<rest>]` with query and hash intact. Mounted
 * in the shared children, so `/:workspaceSlug/community/*` keeps its slug.
 *
 * Each known section is spelled out with static segments: a lone
 * `community/*` splat ranks below `:workspaceSlug/agent/:aid`, which would
 * read `/community/agent/x` as an agent in a workspace called `community`.
 */
const legacyCommunityElement = <LegacyCommunityRedirect />;

const legacyCommunityRedirect = (path: string): RouteObject => ({
  element: legacyCommunityElement,
  handle: LEGACY_REDIRECT_HANDLE,
  path,
});

export const legacyCommunityRoutes: RouteObject[] = [
  {
    element: marketplaceIndexRoute.element,
    handle: LEGACY_REDIRECT_HANDLE,
    path: LEGACY_COMMUNITY_SEGMENT,
  },
  ...LEGACY_COMMUNITY_SECTIONS.flatMap((section) => [
    legacyCommunityRedirect(`${LEGACY_COMMUNITY_SEGMENT}/${section}`),
    legacyCommunityRedirect(`${LEGACY_COMMUNITY_SEGMENT}/${section}/:slug`),
    legacyCommunityRedirect(`${LEGACY_COMMUNITY_SEGMENT}/${section}/:slug/*`),
  ]),
  legacyCommunityRedirect(`${LEGACY_COMMUNITY_SEGMENT}/*`),
];

const LegacyMessengerRedirect = () => {
  const { sub } = useParams();
  const platform = SUPPORTED_MESSENGER_PLATFORMS.find(({ id }) => id === sub);
  return (
    <LegacyPathRedirect to={platform ? marketplaceAppPath(platform.id) : MARKETPLACE_APPS_PATH} />
  );
};

/**
 * `settings/skill`, `settings/connector` and `settings/integrations` (plus their
 * `/:sub` forms) moved to
 * the Marketplace. Mounted under both the personal `/settings` and the
 * workspace `/:workspaceSlug/settings` routes (desktop and mobile); the redirect
 * re-applies the slug and keeps `?open=` / `?skill=` deep links.
 */
const legacySettingsLibraryRedirects: RouteObject[] = [
  ['skill', MARKETPLACE_INSTALLED_SKILLS_PATH],
  ['skill/:sub', MARKETPLACE_INSTALLED_SKILLS_PATH],
  ['connector', MARKETPLACE_INSTALLED_CONNECTORS_PATH],
  ['connector/:sub', MARKETPLACE_INSTALLED_CONNECTORS_PATH],
].map(([path, to]) => ({
  element: <LegacyPathRedirect to={to} />,
  handle: LEGACY_REDIRECT_HANDLE,
  path,
}));

export const legacySettingsMarketplaceRedirects: RouteObject[] = [
  ...legacySettingsLibraryRedirects,
  { element: <LegacyMessengerRedirect />, handle: LEGACY_REDIRECT_HANDLE, path: 'messenger/:sub?' },
  {
    element: <LegacyIntegrationRedirect />,
    handle: LEGACY_REDIRECT_HANDLE,
    path: 'integrations/:sub?',
  },
];
