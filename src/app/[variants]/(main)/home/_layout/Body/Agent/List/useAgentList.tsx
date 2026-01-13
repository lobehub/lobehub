'use client';

import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

export const useAgentList = (limitDefault = true) => {
  useFetchAgentList();

  const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);
  const ungroupedAgents = useHomeStore(
    limitDefault
      ? homeAgentListSelectors.ungroupedAgentsLimited(agentPageSize)
      : homeAgentListSelectors.ungroupedAgents,
    isEqual,
  );
  const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);

  return useMemo(() => {
    return {
      customList: agentGroups,
      defaultList: ungroupedAgents,
      pinnedList: pinnedAgents,
    };
  }, [agentGroups, pinnedAgents, ungroupedAgents]);
};
