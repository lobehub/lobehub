import { ShapesIcon } from 'lucide-react';
import { lazy } from 'react';

import { type RouteMeta, routeMeta } from '@/spa/router/routeMeta';

import type * as CommunityDynamicMetas from './CommunityDynamicMeta';

type CommunityDynamicMetaName = keyof typeof CommunityDynamicMetas;

// Route metas load with the router on first paint; keep the Discover store out of that graph.
const createCommunityDetailRouteMeta = (name: CommunityDynamicMetaName): RouteMeta =>
  routeMeta({
    DynamicMeta: lazy(() =>
      import('./CommunityDynamicMeta').then((module) => ({ default: module[name] })),
    ),
    icon: ShapesIcon,
    titleKey: 'navigation.discover',
  });

/** Community detail routes (`/community/<type>/:slug`), titled after the item they show. */
export const communityDetailRouteMeta = {
  agent: createCommunityDetailRouteMeta('AssistantDynamicMeta'),
  groupAgent: createCommunityDetailRouteMeta('GroupAgentDynamicMeta'),
  mcp: createCommunityDetailRouteMeta('McpDynamicMeta'),
  model: createCommunityDetailRouteMeta('ModelDynamicMeta'),
  provider: createCommunityDetailRouteMeta('ProviderDynamicMeta'),
  skill: createCommunityDetailRouteMeta('SkillDynamicMeta'),
  user: createCommunityDetailRouteMeta('UserDynamicMeta'),
} satisfies Record<string, RouteMeta>;
