import { Image } from 'lucide-react';

import { getRouteById } from '@/config/routes';

import { type ImageParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const imageIcon = getRouteById('image')?.icon || Image;

const IMAGE_PATH_REGEX = /^\/image(\/([^/?]+))?$/;

export const imagePlugin: RecentlyViewedPlugin<'image'> = {
  checkExists(_reference: PageReference<'image'>, _ctx: PluginContext): boolean {
    return true; // Static page always exists
  },
  generateId(reference: PageReference<'image'>): string {
    const { section } = reference.params;
    return section ? `image:${section}` : 'image';
  },

  generateUrl(reference: PageReference<'image'>): string {
    const { section } = reference.params;
    return section ? `/image/${section}` : '/image';
  },

  getDefaultIcon() {
    return imageIcon;
  },

  matchUrl(pathname: string, _searchParams: URLSearchParams): boolean {
    return IMAGE_PATH_REGEX.test(pathname);
  },

  parseUrl(pathname: string, _searchParams: URLSearchParams): PageReference<'image'> | null {
    const match = pathname.match(IMAGE_PATH_REGEX);
    if (!match) return null;

    const section = match[2];
    const params: ImageParams = section ? { section } : {};
    const id = this.generateId({ params } as PageReference<'image'>);

    return createPageReference('image', params, id);
  },

  priority: 5,

  resolve(reference: PageReference<'image'>, ctx: PluginContext): ResolvedPageData {
    return {
      exists: true,
      icon: this.getDefaultIcon!(),
      reference,
      title: ctx.t('navigation.image' as any, { ns: 'electron' }) as string,
      url: this.generateUrl(reference),
    };
  },

  type: 'image',
};
