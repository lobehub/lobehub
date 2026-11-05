import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

/**
 * Whether the mini game may be played with `agentId`: the `mini_game` flag is
 * on and the agent runs on LobeHub's runtime. Heterogeneous agents (Claude
 * Code, Codex…) have no game tool, so they could read the snapshot but never
 * move the character.
 */
export const useMiniGameAvailable = (agentId: string): boolean => {
  const flagEnabled = useServerConfigStore(serverConfigSelectors.enableMiniGame);
  const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  return flagEnabled && !isHeterogeneous;
};

/**
 * For the open game: closes it as soon as it stops being available — the user
 * switched to a heterogeneous agent, or the flag turned off — so later sends
 * no longer carry a snapshot or enable a tool nothing can run.
 */
export const useCloseUnavailableMiniGame = (agentId: string): boolean => {
  const available = useMiniGameAvailable(agentId);

  useEffect(() => {
    if (!available) useChatStore.getState().closeMiniGame();
  }, [available]);

  return available;
};
