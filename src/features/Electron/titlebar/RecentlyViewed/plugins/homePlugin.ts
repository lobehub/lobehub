import { Home } from 'lucide-react';

import { type HomeParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

export const homePlugin: RecentlyViewedPlugin<'home'> = {
  checkExists(_reference: PageReference<'home'>, _ctx: PluginContext): boolean {
    return true; // Home page always exists
  },

  generateId(_reference: PageReference<'home'>): string {
    return 'home';
  },

  generateUrl(_reference: PageReference<'home'>): string {
    return '/';
  },

  getDefaultIcon() {
    return Home;
  },

  // Lowest priority, matched last
  matchUrl(pathname: string, _searchParams: URLSearchParams): boolean {
    return pathname === '/' || pathname === '';
  },

  parseUrl(_pathname: string, _searchParams: URLSearchParams): PageReference<'home'> | null {
    const params: HomeParams = {};
    const id = this.generateId({ params } as PageReference<'home'>);

    return createPageReference('home', params, id);
  },

  priority: 1,

  resolve(reference: PageReference<'home'>, ctx: PluginContext): ResolvedPageData {
    return {
      exists: true,
      icon: this.getDefaultIcon!(),
      reference,
      title: ctx.t('navigation.home' as any, { ns: 'electron' }) as string,
      url: this.generateUrl(reference),
    };
  },

  type: 'home',
};
