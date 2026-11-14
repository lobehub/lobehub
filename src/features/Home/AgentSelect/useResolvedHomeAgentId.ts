import { useCallback, useEffect } from 'react';

import { useCacheScope } from '@/libs/swr/useCacheScope';
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
 * Persist the home-page Agent choice for the current cache scope only, so it
 * never follows the user into another workspace or account.
 */
export const useSelectHomeAgent = (): ((agentId: string) => void) => {
  const scope = useCacheScope();
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  return useCallback(
    (agentId: string) => {
      updateSystemStatus({ homeSelectedAgentIdByScope: { [scope]: agentId } });
    },
    [scope, updateSystemStatus],
  );
};

/**
 * Resolve the home-page Agent picked in the current cache scope, falling back
 * to that scope's Inbox Agent. A persisted id the current agent list no longer
 * contains (deleted agent, a selection made before a database reset) is reset
 * to the Inbox Agent.
 */
export const useResolvedHomeAgentId = (): ResolvedHomeAgent => {
  const scope = useCacheScope();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const selectedAgentId = useGlobalStore(systemStatusSelectors.homeSelectedAgentId(scope));
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const selectedAgent = useHomeStore(homeAgentListSelectors.getAgentById(selectedAgentId ?? ''));
  const selectHomeAgent = useSelectHomeAgent();

  const isStale =
    !!selectedAgentId &&
    !!inboxAgentId &&
    isAgentListInit &&
    selectedAgentId !== inboxAgentId &&
    !selectedAgent;

  useEffect(() => {
    if (!isStale || !inboxAgentId) return;

    selectHomeAgent(inboxAgentId);
  }, [inboxAgentId, isStale, selectHomeAgent]);

  const agentId = isStale ? inboxAgentId : (selectedAgentId ?? inboxAgentId);

  return {
    agentId,
    isInbox: !!agentId && agentId === inboxAgentId,
  };
};
