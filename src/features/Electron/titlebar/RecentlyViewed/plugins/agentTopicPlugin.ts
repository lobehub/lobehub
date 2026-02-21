import { MessageSquare } from 'lucide-react';

import { type AgentTopicParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const AGENT_PATH_REGEX = /^\/agent\/([^/?]+)$/;

export const agentTopicPlugin: RecentlyViewedPlugin<'agent-topic'> = {
  checkExists(reference: PageReference<'agent-topic'>, ctx: PluginContext): boolean {
    const { agentId, topicId } = reference.params;
    const agentMeta = ctx.getAgentMeta(agentId);
    const topic = ctx.getTopic(topicId);

    // Both agent and topic must exist
    return agentMeta !== undefined && Object.keys(agentMeta).length > 0 && topic !== undefined;
  },

  generateId(reference: PageReference<'agent-topic'>): string {
    const { agentId, topicId } = reference.params;
    return `agent-topic:${agentId}:${topicId}`;
  },

  generateUrl(reference: PageReference<'agent-topic'>): string {
    const { agentId, topicId } = reference.params;
    return `/agent/${agentId}?topic=${topicId}`;
  },

  getDefaultIcon() {
    return MessageSquare;
  },

  // Higher priority than agent plugin to match topic URLs first
  matchUrl(pathname: string, searchParams: URLSearchParams): boolean {
    // Match /agent/:id with topic param
    return AGENT_PATH_REGEX.test(pathname) && searchParams.has('topic');
  },

  parseUrl(pathname: string, searchParams: URLSearchParams): PageReference<'agent-topic'> | null {
    const match = pathname.match(AGENT_PATH_REGEX);
    if (!match) return null;

    const topicId = searchParams.get('topic');
    if (!topicId) return null;

    const agentId = match[1];
    const params: AgentTopicParams = { agentId, topicId };
    const id = this.generateId({ params } as PageReference<'agent-topic'>);

    return createPageReference('agent-topic', params, id);
  },

  priority: 20,

  resolve(reference: PageReference<'agent-topic'>, ctx: PluginContext): ResolvedPageData {
    const { agentId, topicId } = reference.params;
    const agentMeta = ctx.getAgentMeta(agentId);
    const topic = ctx.getTopic(topicId);
    const cached = reference.cached;

    const agentExists = agentMeta !== undefined && Object.keys(agentMeta).length > 0;
    const topicExists = topic !== undefined;
    const hasStoreData = agentExists && topicExists;

    // Use topic title if available, otherwise fall back to agent title, then cached
    const title =
      topic?.title ||
      agentMeta?.title ||
      cached?.title ||
      ctx.t('navigation.chat', { ns: 'electron' });

    return {
      avatar: agentMeta?.avatar ?? cached?.avatar,
      backgroundColor: agentMeta?.backgroundColor ?? cached?.backgroundColor,
      exists: hasStoreData || cached !== undefined,
      icon: this.getDefaultIcon!(),
      reference,
      title,
      url: this.generateUrl(reference),
    };
  },

  type: 'agent-topic',
};
