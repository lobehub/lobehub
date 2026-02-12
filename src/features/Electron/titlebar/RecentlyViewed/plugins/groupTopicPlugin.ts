import { Users } from 'lucide-react';

import { type GroupTopicParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const GROUP_PATH_REGEX = /^\/group\/([^/?]+)$/;

export const groupTopicPlugin: RecentlyViewedPlugin<'group-topic'> = {
  checkExists(reference: PageReference<'group-topic'>, ctx: PluginContext): boolean {
    const { groupId, topicId } = reference.params;
    const group = ctx.getSessionGroup(groupId);
    const topic = ctx.getTopic(topicId);

    // Both group and topic must exist
    return group !== undefined && topic !== undefined;
  },

  generateId(reference: PageReference<'group-topic'>): string {
    const { groupId, topicId } = reference.params;
    return `group-topic:${groupId}:${topicId}`;
  },

  generateUrl(reference: PageReference<'group-topic'>): string {
    const { groupId, topicId } = reference.params;
    return `/group/${groupId}?topic=${topicId}`;
  },

  getDefaultIcon() {
    return Users;
  },

  // Higher priority than group plugin to match topic URLs first
  matchUrl(pathname: string, searchParams: URLSearchParams): boolean {
    // Match /group/:id with topic param
    return GROUP_PATH_REGEX.test(pathname) && searchParams.has('topic');
  },

  parseUrl(pathname: string, searchParams: URLSearchParams): PageReference<'group-topic'> | null {
    const match = pathname.match(GROUP_PATH_REGEX);
    if (!match) return null;

    const topicId = searchParams.get('topic');
    if (!topicId) return null;

    const groupId = match[1];
    const params: GroupTopicParams = { groupId, topicId };
    const id = this.generateId({ params } as PageReference<'group-topic'>);

    return createPageReference('group-topic', params, id);
  },

  priority: 20,

  resolve(reference: PageReference<'group-topic'>, ctx: PluginContext): ResolvedPageData {
    const { groupId, topicId } = reference.params;
    const group = ctx.getSessionGroup(groupId);
    const topic = ctx.getTopic(topicId);
    const cached = reference.cached;

    const groupExists = group !== undefined;
    const topicExists = topic !== undefined;
    const hasStoreData = groupExists && topicExists;

    // Use topic title if available, otherwise fall back to group name, then cached
    const title =
      topic?.title ||
      group?.name ||
      cached?.title ||
      ctx.t('navigation.groupChat', { ns: 'electron' });

    return {
      exists: hasStoreData || cached !== undefined,
      icon: this.getDefaultIcon!(),
      reference,
      title,
      url: this.generateUrl(reference),
    };
  },

  type: 'group-topic',
};
