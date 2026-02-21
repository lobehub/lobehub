'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors/selectors';
import { useChatStore } from '@/store/chat';
import { usePageStore } from '@/store/page';
import { listSelectors } from '@/store/page/slices/list/selectors';
import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/slices/sessionGroup/selectors';
import { type ChatTopic } from '@/types/topic';

import { type PluginContext } from '../plugins/types';

/**
 * Search for a topic across all entries in topicDataMap
 * This is needed because getTopicById only searches in the current active session's topics
 */
const findTopicAcrossAllSessions = (
  topicDataMap: Record<string, { items?: ChatTopic[] }>,
  topicId: string,
): ChatTopic | undefined => {
  for (const data of Object.values(topicDataMap)) {
    const topic = data.items?.find((t) => t.id === topicId);
    if (topic) return topic;
  }
  return undefined;
};

/**
 * Hook to create plugin context with access to store data
 */
export const usePluginContext = (): PluginContext => {
  const { t } = useTranslation('electron');

  const agentMap = useAgentStore((s) => s.agentMap);
  const topicDataMap = useChatStore((s) => s.topicDataMap);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const documents = usePageStore((s) => s.documents);

  return useMemo<PluginContext>(
    () => ({
      getAgentMeta: (agentId: string) => {
        const state = useAgentStore.getState();
        return agentSelectors.getAgentMetaById(agentId)(state);
      },

      getDocument: (documentId: string) => {
        const state = usePageStore.getState();
        return listSelectors.getDocumentById(documentId)(state);
      },

      getSessionGroup: (groupId: string) => {
        const state = useSessionStore.getState();
        return sessionGroupSelectors.getGroupById(groupId)(state);
      },

      getTopic: (topicId: string) => {
        // Search across ALL entries in topicDataMap, not just current session
        // This ensures we can find topics even after navigating away from the agent page
        const state = useChatStore.getState();
        return findTopicAcrossAllSessions(state.topicDataMap, topicId);
      },

      t: (key: string, options?: Record<string, unknown>) => t(key as any, options) as string,
    }),
    [agentMap, topicDataMap, sessionGroups, documents, t],
  );
};
