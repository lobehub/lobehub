import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { type AgentItemData } from './AgentItem';
import { selectAddableAgents, toPickableAgents } from './selectAddableAgents';

/**
 * Candidates for the "add member" picker, read from the sidebar agent list
 * replica: it already holds every non-virtual agent, so the local copy paints
 * the picker at once and the sync only confirms it.
 *
 * `sharedOnly` leaves the caller's private agents out, for containers every
 * workspace member sees (a shared project would hide them from everyone else).
 */
export const useAddableGroupMembers = (
  existingMembers: string[],
  { sharedOnly = false }: { sharedOnly?: boolean } = {},
) => {
  const { error } = useFetchAgentList();
  const sidebarAgents = useHomeStore(
    sharedOnly ? homeAgentListSelectors.sharedAgents : homeAgentListSelectors.allAgents,
    isEqual,
  );
  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const isAgentListConfirmed = useHomeStore(homeAgentListSelectors.isAgentListConfirmed);

  const allAgents = useMemo(() => toPickableAgents(sidebarAgents), [sidebarAgents]);
  // Existing members and the inbox (which cannot join a group) are not offered.
  const availableAgents = useMemo<AgentItemData[]>(
    () => selectAddableAgents(allAgents, existingMembers),
    [allAgents, existingMembers],
  );

  // A restored empty list is not "you have no agents" until the server says so.
  const isLoading = !isAgentListInit || (allAgents.length === 0 && !isAgentListConfirmed && !error);

  return { allAgents, availableAgents, isLoading };
};
