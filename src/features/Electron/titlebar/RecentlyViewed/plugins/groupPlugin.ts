import { Users } from 'lucide-react';

import { type GroupParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const GROUP_PATH_REGEX = /^\/group\/([^/?]+)$/;

export const groupPlugin: RecentlyViewedPlugin<'group'> = {
  checkExists(reference: PageReference<'group'>, ctx: PluginContext): boolean {
    const group = ctx.getSessionGroup(reference.params.groupId);
    return group !== undefined;
  },
  generateId(reference: PageReference<'group'>): string {
    return `group:${reference.params.groupId}`;
  },

  generateUrl(reference: PageReference<'group'>): string {
    return `/group/${reference.params.groupId}`;
  },

  getDefaultIcon() {
    return Users;
  },

  matchUrl(pathname: string, searchParams: URLSearchParams): boolean {
    // Match /group/:id but NOT when there's a topic param
    return GROUP_PATH_REGEX.test(pathname) && !searchParams.has('topic');
  },

  parseUrl(pathname: string, _searchParams: URLSearchParams): PageReference<'group'> | null {
    const match = pathname.match(GROUP_PATH_REGEX);
    if (!match) return null;

    const groupId = match[1];
    const params: GroupParams = { groupId };
    const id = this.generateId({ params } as PageReference<'group'>);

    return createPageReference('group', params, id);
  },

  priority: 10,

  resolve(reference: PageReference<'group'>, ctx: PluginContext): ResolvedPageData {
    const group = ctx.getSessionGroup(reference.params.groupId);
    const hasStoreData = group !== undefined;
    const cached = reference.cached;

    return {
      exists: hasStoreData || cached !== undefined,
      icon: this.getDefaultIcon!(),
      reference,
      title: group?.name || cached?.title || ctx.t('navigation.groupChat', { ns: 'electron' }),
      url: this.generateUrl(reference),
    };
  },

  type: 'group',
};
