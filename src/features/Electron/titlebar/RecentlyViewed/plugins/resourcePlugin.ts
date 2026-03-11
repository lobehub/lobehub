import { Database } from 'lucide-react';

import { getRouteById } from '@/config/routes';

import { type PageReference, type ResolvedPageData, type ResourceParams } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const resourceIcon = getRouteById('resource')?.icon || Database;

const RESOURCE_PATH_REGEX = /^\/resource(\/([^/?]+))?$/;

// Section to title key mapping
const sectionTitleKeys: Record<string, string> = {
  library: 'navigation.knowledgeBase',
};

export const resourcePlugin: RecentlyViewedPlugin<'resource'> = {
  checkExists(_reference: PageReference<'resource'>, _ctx: PluginContext): boolean {
    return true; // Static page always exists
  },
  generateId(reference: PageReference<'resource'>): string {
    const { section } = reference.params;
    return section ? `resource:${section}` : 'resource';
  },

  generateUrl(reference: PageReference<'resource'>): string {
    const { section } = reference.params;
    return section ? `/resource/${section}` : '/resource';
  },

  getDefaultIcon() {
    return resourceIcon;
  },

  matchUrl(pathname: string, _searchParams: URLSearchParams): boolean {
    return RESOURCE_PATH_REGEX.test(pathname);
  },

  parseUrl(pathname: string, _searchParams: URLSearchParams): PageReference<'resource'> | null {
    const match = pathname.match(RESOURCE_PATH_REGEX);
    if (!match) return null;

    const section = match[2];
    const params: ResourceParams = section ? { section } : {};
    const id = this.generateId({ params } as PageReference<'resource'>);

    return createPageReference('resource', params, id);
  },

  priority: 5,

  resolve(reference: PageReference<'resource'>, ctx: PluginContext): ResolvedPageData {
    const { section } = reference.params;
    const titleKey = section
      ? sectionTitleKeys[section] || 'navigation.resources'
      : 'navigation.resources';

    return {
      exists: true,
      icon: this.getDefaultIcon!(),
      reference,
      title: ctx.t(titleKey as any, { ns: 'electron' }) as string,
      url: this.generateUrl(reference),
    };
  },

  type: 'resource',
};
