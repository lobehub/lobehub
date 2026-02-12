import { ShapesIcon } from 'lucide-react';

import { getRouteById } from '@/config/routes';

import { type CommunityParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const communityIcon = getRouteById('community')?.icon || ShapesIcon;

const COMMUNITY_PATH_REGEX = /^\/community(\/([^/?]+))?$/;

// Section to title key mapping
const sectionTitleKeys: Record<string, string> = {
  agent: 'navigation.discoverAssistants',
  mcp: 'navigation.discoverMcp',
  model: 'navigation.discoverModels',
  provider: 'navigation.discoverProviders',
};

export const communityPlugin: RecentlyViewedPlugin<'community'> = {
  checkExists(_reference: PageReference<'community'>, _ctx: PluginContext): boolean {
    return true; // Static page always exists
  },
  generateId(reference: PageReference<'community'>): string {
    const { section } = reference.params;
    return section ? `community:${section}` : 'community';
  },

  generateUrl(reference: PageReference<'community'>): string {
    const { section } = reference.params;
    return section ? `/community/${section}` : '/community';
  },

  getDefaultIcon() {
    return communityIcon;
  },

  matchUrl(pathname: string, _searchParams: URLSearchParams): boolean {
    return COMMUNITY_PATH_REGEX.test(pathname);
  },

  parseUrl(pathname: string, _searchParams: URLSearchParams): PageReference<'community'> | null {
    const match = pathname.match(COMMUNITY_PATH_REGEX);
    if (!match) return null;

    const section = match[2]; // Optional section like 'agent', 'model', etc.
    const params: CommunityParams = section ? { section } : {};
    const id = this.generateId({ params } as PageReference<'community'>);

    return createPageReference('community', params, id);
  },

  priority: 5,

  resolve(reference: PageReference<'community'>, ctx: PluginContext): ResolvedPageData {
    const { section } = reference.params;
    const titleKey = section
      ? sectionTitleKeys[section] || 'navigation.discover'
      : 'navigation.discover';

    return {
      exists: true,
      icon: this.getDefaultIcon!(),
      reference,
      title: ctx.t(titleKey as any, { ns: 'electron' }) as string,
      url: this.generateUrl(reference),
    };
  },

  type: 'community',
};
