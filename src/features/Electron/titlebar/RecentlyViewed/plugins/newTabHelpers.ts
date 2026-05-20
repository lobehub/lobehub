import { lambdaClient } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { usePageStore } from '@/store/page';
import { DocumentSourceType, type LobeDocument } from '@/types/document';

import { type CachedPageData, type PageReference } from '../types';
import { type NewTabAction, type NewTabActionResult, type PluginContext } from './types';

const EDITOR_PAGE_FILE_TYPE = 'custom/document';

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
      const pageStore = usePageStore.getState();

      // Create the real page via service first — once the row exists on
      // the server, any SWR revalidation of the page list will include
      // it and won't clobber the optimistic add we do below.
      const newPage = await pageStore.createPage({ content: '', title: untitled });

      // Synthesize a `LobeDocument` for the sidebar list.
      const now = new Date();
      const document: LobeDocument = {
        content: newPage.content || '',
        createdAt: newPage.createdAt ? new Date(newPage.createdAt) : now,
        editorData:
          typeof newPage.editorData === 'string'
            ? (() => {
                try {
                  return JSON.parse(newPage.editorData);
                } catch {
                  return null;
                }
              })()
            : newPage.editorData || null,
        fileType: newPage.fileType || EDITOR_PAGE_FILE_TYPE,
        filename: newPage.title || untitled,
        id: newPage.id,
        metadata: newPage.metadata || {},
        source: 'document',
        sourceType: DocumentSourceType.EDITOR,
        title: newPage.title || untitled,
        totalCharCount: (newPage.content || '').length,
        totalLineCount: 0,
        updatedAt: newPage.updatedAt ? new Date(newPage.updatedAt) : now,
      };

      // Dispatch into the sidebar list and mark selected so the nav item
      // highlights in sync with the new tab.
      pageStore.internal_dispatchDocuments({ document, type: 'addDocument' });
      usePageStore.setState({ selectedPageId: newPage.id }, false, 'TabBar/newPage');

      const reference: PageReference<'page'> = {
        id: `page:${newPage.id}`,
        lastVisited: Date.now(),
        params: { pageId: newPage.id },
        type: 'page',
      };

      const cached: CachedPageData = {
        title: document.title || untitled,
      };

      return { cached, reference };
    },
  };
};
