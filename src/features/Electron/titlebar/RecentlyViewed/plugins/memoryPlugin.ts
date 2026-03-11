import { Brain } from 'lucide-react';

import { getRouteById } from '@/config/routes';

import { type MemoryParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const memoryIcon = getRouteById('memory')?.icon || Brain;

const MEMORY_PATH_REGEX = /^\/memory(\/([^/?]+))?$/;

// Section to title key mapping
const sectionTitleKeys: Record<string, string> = {
  contexts: 'navigation.memoryContexts',
  experiences: 'navigation.memoryExperiences',
  identities: 'navigation.memoryIdentities',
  preferences: 'navigation.memoryPreferences',
};

export const memoryPlugin: RecentlyViewedPlugin<'memory'> = {
  checkExists(_reference: PageReference<'memory'>, _ctx: PluginContext): boolean {
    return true; // Static page always exists
  },
  generateId(reference: PageReference<'memory'>): string {
    const { section } = reference.params;
    return section ? `memory:${section}` : 'memory';
  },

  generateUrl(reference: PageReference<'memory'>): string {
    const { section } = reference.params;
    return section ? `/memory/${section}` : '/memory';
  },

  getDefaultIcon() {
    return memoryIcon;
  },

  matchUrl(pathname: string, _searchParams: URLSearchParams): boolean {
    return MEMORY_PATH_REGEX.test(pathname);
  },

  parseUrl(pathname: string, _searchParams: URLSearchParams): PageReference<'memory'> | null {
    const match = pathname.match(MEMORY_PATH_REGEX);
    if (!match) return null;

    const section = match[2];
    const params: MemoryParams = section ? { section } : {};
    const id = this.generateId({ params } as PageReference<'memory'>);

    return createPageReference('memory', params, id);
  },

  priority: 5,

  resolve(reference: PageReference<'memory'>, ctx: PluginContext): ResolvedPageData {
    const { section } = reference.params;
    const titleKey = section
      ? sectionTitleKeys[section] || 'navigation.memory'
      : 'navigation.memory';

    return {
      exists: true,
      icon: this.getDefaultIcon!(),
      reference,
      title: ctx.t(titleKey as any, { ns: 'electron' }) as string,
      url: this.generateUrl(reference),
    };
  },

  type: 'memory',
};
