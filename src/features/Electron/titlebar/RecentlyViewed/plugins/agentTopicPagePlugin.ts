import { FileText } from 'lucide-react';

import { getRouteById } from '@/config/routes';
import { SESSION_CHAT_TOPIC_PAGE_URL } from '@/const/url';
import { useChatStore } from '@/store/chat';

import { type AgentTopicPageParams, type PageReference, type ResolvedPageData } from '../types';
import { type PluginContext, type RecentlyViewedPlugin } from './types';
import { createPageReference } from './types';

const AGENT_TOPIC_PAGE_PATH_REGEX = /^\/agent\/([^/?]+)\/(tpc_[^/?]+)\/page(?:\/([^/?]+))?$/;

const pageIcon = getRouteById('page')?.icon || FileText;

export const agentTopicPagePlugin: RecentlyViewedPlugin<'agent-topic-page'> = {
  checkExists(reference: PageReference<'agent-topic-page'>, ctx: PluginContext): boolean {
    const { agentId, topicId } = reference.params;
    const agentMeta = ctx.getAgentMeta(agentId);
    const topic = ctx.getTopic(topicId);

    return agentMeta !== undefined && Object.keys(agentMeta).length > 0 && topic !== undefined;
  },

  generateId(reference: PageReference<'agent-topic-page'>): string {
    const { agentId, topicId, docId } = reference.params;
    return docId
      ? `agent-topic-page:${agentId}:${topicId}:${docId}`
      : `agent-topic-page:${agentId}:${topicId}`;
  },

  generateUrl(reference: PageReference<'agent-topic-page'>): string {
    const { agentId, topicId, docId } = reference.params;
    const base = SESSION_CHAT_TOPIC_PAGE_URL(agentId, topicId);
    return docId ? `${base}/${docId}` : base;
  },

  getDefaultIcon() {
    return pageIcon;
  },

  matchUrl(pathname: string, _searchParams: URLSearchParams): boolean {
    return AGENT_TOPIC_PAGE_PATH_REGEX.test(pathname);
  },

  onActivate(reference: PageReference<'agent-topic-page'>) {
    useChatStore.getState().switchTopic(reference.params.topicId);
  },

  parseUrl(
    pathname: string,
    _searchParams: URLSearchParams,
  ): PageReference<'agent-topic-page'> | null {
    const match = pathname.match(AGENT_TOPIC_PAGE_PATH_REGEX);
    if (!match) return null;

    const [, agentId, topicId, docId] = match;
    const params: AgentTopicPageParams = { agentId, topicId, ...(docId ? { docId } : {}) };
    const id = this.generateId({ params } as PageReference<'agent-topic-page'>);
    return createPageReference('agent-topic-page', params, id);
  },

  priority: 30,

  resolve(reference: PageReference<'agent-topic-page'>, ctx: PluginContext): ResolvedPageData {
    const { agentId, topicId } = reference.params;
    const agentMeta = ctx.getAgentMeta(agentId);
    const topic = ctx.getTopic(topicId);
    const cached = reference.cached;

    const agentExists = agentMeta !== undefined && Object.keys(agentMeta).length > 0;
    const topicExists = topic !== undefined;
    const hasStoreData = agentExists && topicExists;

    return {
      avatar: agentMeta?.avatar ?? cached?.avatar,
      backgroundColor: agentMeta?.backgroundColor ?? cached?.backgroundColor,
      exists: hasStoreData || cached !== undefined,
      icon: this.getDefaultIcon!(),
      reference,
      title:
        cached?.title ||
        topic?.title ||
        agentMeta?.title ||
        ctx.t('navigation.page', { ns: 'electron' }),
      url: this.generateUrl(reference),
    };
  },

  type: 'agent-topic-page',
};
