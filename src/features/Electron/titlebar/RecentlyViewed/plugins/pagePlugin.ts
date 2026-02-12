import { FileText } from 'lucide-react';

import { getRouteById } from '@/config/routes';

import { type PageParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const PAGE_PATH_REGEX = /^\/page\/([^/?]+)$/;

const pageIcon = getRouteById('page')?.icon || FileText;

export const pagePlugin: RecentlyViewedPlugin<'page'> = {
  checkExists(reference: PageReference<'page'>, ctx: PluginContext): boolean {
    const document = ctx.getDocument(reference.params.pageId);
    return document !== undefined;
  },
  generateId(reference: PageReference<'page'>): string {
    return `page:${reference.params.pageId}`;
  },

  generateUrl(reference: PageReference<'page'>): string {
    return `/page/${reference.params.pageId}`;
  },

  getDefaultIcon() {
    return pageIcon;
  },

  matchUrl(pathname: string, _searchParams: URLSearchParams): boolean {
    return PAGE_PATH_REGEX.test(pathname);
  },

  parseUrl(pathname: string, _searchParams: URLSearchParams): PageReference<'page'> | null {
    const match = pathname.match(PAGE_PATH_REGEX);
    if (!match) return null;

    const pageId = match[1];
    const params: PageParams = { pageId };
    const id = this.generateId({ params } as PageReference<'page'>);

    return createPageReference('page', params, id);
  },

  priority: 10,

  resolve(reference: PageReference<'page'>, ctx: PluginContext): ResolvedPageData {
    const document = ctx.getDocument(reference.params.pageId);
    const hasStoreData = document !== undefined;
    const cached = reference.cached;

    return {
      exists: hasStoreData || cached !== undefined,
      icon: this.getDefaultIcon!(),
      reference,
      title: document?.title || cached?.title || ctx.t('navigation.page', { ns: 'electron' }),
      url: this.generateUrl(reference),
    };
  },

  type: 'page',
};
