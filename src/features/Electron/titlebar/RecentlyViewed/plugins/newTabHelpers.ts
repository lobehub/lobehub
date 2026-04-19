import { lambdaClient } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { usePageStore } from '@/store/page';

import { type CachedPageData, type PageReference } from '../types';
import { type NewTabAction, type NewTabActionResult, type PluginContext } from './types';

/**
 * Build a NewTabAction that creates a fresh topic under an agent and
 * returns an `agent-topic` reference pointing to it. The new reference
 * id embeds the topicId, which is globally unique, so it never collides
 * with the existing tab it was opened from.
 */
export const buildAgentNewTopicAction = (
  agentId: string,
  ctx: PluginContext,
): NewTabAction | null => {
  const meta = ctx.getAgentMeta(agentId);
  if (!meta || Object.keys(meta).length === 0) return null;

  return {
    onCreate: async (): Promise<NewTabActionResult | null> => {
      const defaultTitle = ctx.t('defaultTitle', { ns: 'topic' });
      const topicId = await lambdaClient.topic.createTopic.mutate({
        agentId,
        messages: [],
        title: defaultTitle,
      });

      await useChatStore.getState().refreshTopic();

      const reference: PageReference<'agent-topic'> = {
        id: `agent-topic:${agentId}:${topicId}`,
        lastVisited: Date.now(),
        params: { agentId, topicId },
        type: 'agent-topic',
      };

      const cached: CachedPageData = {
        avatar: meta.avatar,
        backgroundColor: meta.backgroundColor,
        title: defaultTitle,
      };

      return { cached, reference };
    },
  };
};

/**
 * Build a NewTabAction that creates a fresh topic under a group and
 * returns a `group-topic` reference pointing to it.
 */
export const buildGroupNewTopicAction = (
  groupId: string,
  ctx: PluginContext,
): NewTabAction | null => {
  const group = ctx.getSessionGroup(groupId);
  if (!group) return null;

  return {
    onCreate: async (): Promise<NewTabActionResult | null> => {
      const defaultTitle = ctx.t('defaultTitle', { ns: 'topic' });
      const topicId = await lambdaClient.topic.createTopic.mutate({
        groupId,
        messages: [],
        title: defaultTitle,
      });

      await useChatStore.getState().refreshTopic();

      const reference: PageReference<'group-topic'> = {
        id: `group-topic:${groupId}:${topicId}`,
        lastVisited: Date.now(),
        params: { groupId, topicId },
        type: 'group-topic',
      };

      const cached: CachedPageData = {
        title: defaultTitle,
      };

      return { cached, reference };
    },
  };
};

/**
 * Build a NewTabAction that creates a fresh untitled page document and
 * returns a `page` reference pointing to it.
 */
export const buildPageNewTabAction = (ctx: PluginContext): NewTabAction => {
  return {
    onCreate: async (): Promise<NewTabActionResult | null> => {
      const untitled = ctx.t('pageList.untitled', { ns: 'file' });
      const newPage = await usePageStore.getState().createPage({ content: '', title: untitled });

      const pageId = newPage.id;
      const reference: PageReference<'page'> = {
        id: `page:${pageId}`,
        lastVisited: Date.now(),
        params: { pageId },
        type: 'page',
      };

      const cached: CachedPageData = {
        title: newPage.title || untitled,
      };

      return { cached, reference };
    },
  };
};
