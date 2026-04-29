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
 * `homeSelectedAgentId` is persisted in browser-scoped systemStatus
 * localStorage, so switching accounts on the same browser leaves the previous
 * account's agent id behind. If that id doesn't belong to the current account
 * we fall back to inbox and reset the persisted value, so the dropdown / send
 * flow stop pointing at a missing agent (which would otherwise render the
 * generic "Custom Agent" + default avatar fallback).
 */
export const useResolvedHomeAgentId = (): ResolvedHomeAgent => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const selectedAgentId = useGlobalStore(systemStatusSelectors.homeSelectedAgentId);
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const sidebarItem = useHomeStore(homeAgentListSelectors.getAgentById(selectedAgentId ?? ''));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const isStale =
    !!selectedAgentId &&
    !!inboxAgentId &&
    isAgentListInit &&
    selectedAgentId !== inboxAgentId &&
    !sidebarItem;

  useEffect(() => {
    if (!isStale || !inboxAgentId) return;
    // `merge` skips `undefined` source values, so we can't clear the field
    // by passing `undefined`. Reset to the inbox id — semantically equivalent
    // to "no override".
    updateSystemStatus({ homeSelectedAgentId: inboxAgentId });
  }, [isStale, inboxAgentId, updateSystemStatus]);

  const agentId = isStale ? inboxAgentId : (selectedAgentId ?? inboxAgentId);

  return {
    agentId,
    isInbox: !!agentId && agentId === inboxAgentId,
  };
};
