import { useState } from 'react';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { readRememberedMainAgent, resolveDefaultMainAgent } from './mainAgentStorage';

/** The main agent a new project starts with: the remembered pick while it still exists, else LobeAI. */
export const useDefaultMainAgent = () => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const [remembered] = useState(() => readRememberedMainAgent(getActiveWorkspaceId()));
  return useHomeStore((s) =>
    resolveDefaultMainAgent({
      // New projects are shared, so a private agent is not a valid default.
      agentExists: (id) => homeAgentListSelectors.sharedAgents(s).some((agent) => agent.id === id),
      inboxAgentId,
      listLoaded: homeAgentListSelectors.isAgentListInit(s),
      remembered,
    }),
  );
};
