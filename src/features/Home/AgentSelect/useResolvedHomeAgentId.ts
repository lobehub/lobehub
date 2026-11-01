import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

interface ResolvedHomeAgent {
  agentId: string | undefined;
  isInbox: boolean;
}

/**
 * Resolve the persisted home-page Agent selection, resetting stale ids left by
 * another account to the current account's Inbox Agent.
 */
export const useResolvedHomeAgentId = (): ResolvedHomeAgent => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const selectedAgentId = useGlobalStore(systemStatusSelectors.homeSelectedAgentId);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const selectedAgent = useHomeStore(homeAgentListSelectors.getAgentById(selectedAgentId ?? ''));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const isStale =
    !!selectedAgentId &&
    !!inboxAgentId &&
    isAgentListInit &&
    selectedAgentId !== inboxAgentId &&
    !selectedAgent;

  useEffect(() => {
    if (!isStale || !inboxAgentId) return;

    updateSystemStatus({ homeSelectedAgentId: inboxAgentId });
  }, [inboxAgentId, isStale, updateSystemStatus]);

  const agentId = isStale ? inboxAgentId : (selectedAgentId ?? inboxAgentId);

  return {
    agentId,
    isInbox: !!agentId && agentId === inboxAgentId,
  };
};
