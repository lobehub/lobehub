import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useHomeAgentRows } from './useHomeAgentRows';

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
  const { isInitialized, privateRows, workspaceRows } = useHomeAgentRows();
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const hasSelectedAgent = [...privateRows, ...workspaceRows].some(
    (agent) => agent.id === selectedAgentId,
  );

  const isStale =
    !!selectedAgentId &&
    !!inboxAgentId &&
    isInitialized &&
    selectedAgentId !== inboxAgentId &&
    !hasSelectedAgent;

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
