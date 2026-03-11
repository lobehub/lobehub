import { Settings } from 'lucide-react';

import { getRouteById } from '@/config/routes';

import { type PageReference, type ResolvedPageData, type SettingsParams } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const settingsIcon = getRouteById('settings')?.icon || Settings;

const SETTINGS_PATH_REGEX = /^\/settings(\/([^/?]+))?$/;

export const settingsPlugin: RecentlyViewedPlugin<'settings'> = {
  checkExists(_reference: PageReference<'settings'>, _ctx: PluginContext): boolean {
    return true; // Static page always exists
  },
  generateId(reference: PageReference<'settings'>): string {
    const { section } = reference.params;
    return section ? `settings:${section}` : 'settings';
  },

  generateUrl(reference: PageReference<'settings'>): string {
    const { section } = reference.params;
    return section ? `/settings/${section}` : '/settings';
  },

  getDefaultIcon() {
    return settingsIcon;
  },

  matchUrl(pathname: string, _searchParams: URLSearchParams): boolean {
    return SETTINGS_PATH_REGEX.test(pathname);
  },

  parseUrl(pathname: string, _searchParams: URLSearchParams): PageReference<'settings'> | null {
    const match = pathname.match(SETTINGS_PATH_REGEX);
    if (!match) return null;

    const section = match[2]; // Optional section like 'provider'
    const params: SettingsParams = section ? { section } : {};
    const id = this.generateId({ params } as PageReference<'settings'>);

    return createPageReference('settings', params, id);
  },

  priority: 5,

  resolve(reference: PageReference<'settings'>, ctx: PluginContext): ResolvedPageData {
    const { section } = reference.params;

    // Get title based on section
    let titleKey = 'navigation.settings';
    if (section === 'provider') {
      titleKey = 'navigation.provider';
    }

    return {
      exists: true,
      icon: this.getDefaultIcon!(),
      reference,
      title: ctx.t(titleKey as any, { ns: 'electron' }) as string,
      url: this.generateUrl(reference),
    };
  },

  type: 'settings',
};
