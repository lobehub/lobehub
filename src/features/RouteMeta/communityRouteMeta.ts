import { LayoutGridPlus } from 'lucide-react';
import { lazy } from 'react';

import { MarketplaceDetailSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { type RouteMeta, routeMeta } from '@/spa/router/routeMeta';

import type * as CommunityDynamicMetas from './CommunityDynamicMeta';

type CommunityDynamicMetaName = keyof typeof CommunityDynamicMetas;

// Route metas load with the router on first paint; keep the Discover store out of that graph.
const createCommunityDetailRouteMeta = (
  name: CommunityDynamicMetaName,
  Skeleton?: RouteMeta['Skeleton'],
): RouteMeta =>
  routeMeta({
    ...(Skeleton && { Skeleton }),
    DynamicMeta: lazy(() =>
      import('./CommunityDynamicMeta').then((module) => ({ default: module[name] })),
    ),
    icon: LayoutGridPlus,
    titleKey: 'navigation.marketplace',
  });

/** Community detail routes (`/marketplace/<type>/:slug`), titled after the item they show. */
export const communityDetailRouteMeta = {
  // Agent and skill pages are the Marketplace design; their skeleton draws that page.
  agent: createCommunityDetailRouteMeta('AssistantDynamicMeta', MarketplaceDetailSkeleton),
  groupAgent: createCommunityDetailRouteMeta('GroupAgentDynamicMeta'),
  mcp: createCommunityDetailRouteMeta('McpDynamicMeta'),
  model: createCommunityDetailRouteMeta('ModelDynamicMeta'),
  provider: createCommunityDetailRouteMeta('ProviderDynamicMeta'),
  skill: createCommunityDetailRouteMeta('SkillDynamicMeta', MarketplaceDetailSkeleton),
  user: createCommunityDetailRouteMeta('UserDynamicMeta'),
} satisfies Record<string, RouteMeta>;
