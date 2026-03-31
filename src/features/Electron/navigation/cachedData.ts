import {
  type CachedPageData,
  type PageReference,
} from '@/features/Electron/titlebar/RecentlyViewed/types';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors/selectors';
import { useChatStore } from '@/store/chat';
import { usePageStore } from '@/store/page';
import { listSelectors } from '@/store/page/slices/list/selectors';
import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/slices/sessionGroup/selectors';

/**
 * Get cached display data for a page reference
 * Shared by useNavigationHistory and useTabNavigation
 */
export const getCachedDataForReference = (reference: PageReference): CachedPageData | undefined => {
  switch (reference.type) {
    case 'agent':
    case 'agent-topic': {
      const agentId = 'agentId' in reference.params ? reference.params.agentId : undefined;
      if (!agentId) return undefined;

      const meta = agentSelectors.getAgentMetaById(agentId)(useAgentStore.getState());
      if (!meta || Object.keys(meta).length === 0) return undefined;

      let title = meta.title;
      if (reference.type === 'agent-topic' && 'topicId' in reference.params) {
        const topicId = reference.params.topicId;
        const topicDataMap = useChatStore.getState().topicDataMap;
        for (const data of Object.values(topicDataMap)) {
          const topic = data.items?.find((t) => t.id === topicId);
          if (topic?.title) {
            title = topic.title;
            break;
          }
        }
      }

      return {
        avatar: meta.avatar,
        backgroundColor: meta.backgroundColor,
        title: title || '',
      };
    }

    case 'group':
    case 'group-topic': {
      const groupId = 'groupId' in reference.params ? reference.params.groupId : undefined;
      if (!groupId) return undefined;

      const group = sessionGroupSelectors.getGroupById(groupId)(useSessionStore.getState());
      if (!group) return undefined;

      let title = group.name;
      if (reference.type === 'group-topic' && 'topicId' in reference.params) {
        const topicId = reference.params.topicId;
        const topicDataMap = useChatStore.getState().topicDataMap;
        for (const data of Object.values(topicDataMap)) {
          const topic = data.items?.find((t) => t.id === topicId);
          if (topic?.title) {
            title = topic.title;
            break;
          }
        }
      }

      return { title: title || '' };
    }

    case 'page': {
      const pageId = 'pageId' in reference.params ? reference.params.pageId : undefined;
      if (!pageId) return undefined;

      const document = listSelectors.getDocumentById(pageId)(usePageStore.getState());
      if (!document) return undefined;

      return { title: document.title || '' };
    }

    default: {
      return undefined;
    }
  }
};
