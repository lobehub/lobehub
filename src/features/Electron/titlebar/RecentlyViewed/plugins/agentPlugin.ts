import { MessageSquare } from 'lucide-react';

import { type AgentParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const AGENT_PATH_REGEX = /^\/agent\/([^/?]+)$/;

export const agentPlugin: RecentlyViewedPlugin<'agent'> = {
  checkExists(reference: PageReference<'agent'>, ctx: PluginContext): boolean {
    const meta = ctx.getAgentMeta(reference.params.agentId);
    return meta !== undefined && Object.keys(meta).length > 0;
  },
  generateId(reference: PageReference<'agent'>): string {
    return `agent:${reference.params.agentId}`;
  },

  generateUrl(reference: PageReference<'agent'>): string {
    return `/agent/${reference.params.agentId}`;
  },

  getDefaultIcon() {
    return MessageSquare;
  },

  matchUrl(pathname: string, searchParams: URLSearchParams): boolean {
    // Match /agent/:id but NOT when there's a topic param
    return AGENT_PATH_REGEX.test(pathname) && !searchParams.has('topic');
  },

  parseUrl(pathname: string, _searchParams: URLSearchParams): PageReference<'agent'> | null {
    const match = pathname.match(AGENT_PATH_REGEX);
    if (!match) return null;

    const agentId = match[1];
    const params: AgentParams = { agentId };
    const id = this.generateId({ params } as PageReference<'agent'>);

    return createPageReference('agent', params, id);
  },

  priority: 10,

  resolve(reference: PageReference<'agent'>, ctx: PluginContext): ResolvedPageData {
    const meta = ctx.getAgentMeta(reference.params.agentId);
    const hasStoreData = meta !== undefined && Object.keys(meta).length > 0;
    const cached = reference.cached;

    // Use store data if available, otherwise fallback to cached data
    return {
      avatar: meta?.avatar ?? cached?.avatar,
      backgroundColor: meta?.backgroundColor ?? cached?.backgroundColor,
      exists: hasStoreData || cached !== undefined,
      icon: this.getDefaultIcon!(),
      reference,
      title: meta?.title || cached?.title || ctx.t('navigation.chat', { ns: 'electron' }),
      url: this.generateUrl(reference),
    };
  },

  type: 'agent',
};
