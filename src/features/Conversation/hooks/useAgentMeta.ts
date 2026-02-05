import type {MetaData} from '@lobechat/types';
import { useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { contextSelectors, useConversationStore } from '../store';

const LOBE_AI_TITLE = 'Lobe AI';

/**
 * Hook to get agent meta data for a specific agent or the current conversation.
 * Handles special cases for builtin agents (inbox, page agent, agent builder)
 * by showing Lobe AI title instead of the agent's own meta.
 * Avatar is now returned from the backend (merged from builtin-agents package).
 *
 * @param messageAgentId - Optional agent ID from the message. If provided, uses this agent's meta.
 *                         Falls back to the current conversation's agent if not provided.
 */
export const useAgentMeta = (messageAgentId?: string | null): MetaData => {
  const contextAgentId = useConversationStore(contextSelectors.agentId);
  // Use message's agentId if provided, otherwise fallback to context agentId
  const agentId = messageAgentId || contextAgentId;
  const agentMeta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const builtinAgentIdMap = useAgentStore((s) => s.builtinAgentIdMap);

  return useMemo(() => {
    // Check if the current agent is a builtin agent
    const builtinAgentIds = Object.values(builtinAgentIdMap);
    const isBuiltinAgent = builtinAgentIds.includes(agentId);

    if (isBuiltinAgent) {
      // Use avatar from backend (merged from builtin-agents package), only override title
      return { ...agentMeta, title: LOBE_AI_TITLE };
    }

    return agentMeta;
  }, [agentId, agentMeta, builtinAgentIdMap]);
};

/**
 * Hook to check if the current agent is a builtin agent
 */
export const useIsBuiltinAgent = (): boolean => {
  const agentId = useConversationStore(contextSelectors.agentId);
  const builtinAgentIdMap = useAgentStore((s) => s.builtinAgentIdMap);

  return useMemo(() => {
    const builtinAgentIds = Object.values(builtinAgentIdMap);
    return builtinAgentIds.includes(agentId);
  }, [agentId, builtinAgentIdMap]);
};
