import type { LobeAgentConfig } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

export type ClientSubAgentTarget = { config: LobeAgentConfig; title: string } | { error: string };

/**
 * Load the agent a client-run `callSubAgent({ agentId })` hands its work to,
 * so the child runs on that agent's own config. The read goes through the
 * user's own scoped `getAgentConfigById`, so an agent outside the user's
 * reach is reported as not found. An external (heterogeneous) agent such as
 * Claude Code cannot run in the client runtime: its CLI is driven by the
 * server's dispatch.
 */
export const resolveClientSubAgentTarget = async (
  agentId: string,
): Promise<ClientSubAgentTarget> => {
  let config = agentSelectors.getAgentConfigById(agentId)(getAgentStoreState()) as
    LobeAgentConfig | undefined;
  const cachedMeta = getAgentStoreState().agentMap[agentId];

  if (!cachedMeta) {
    const fetched = (await agentService.getAgentConfigById(agentId)) as LobeAgentConfig | null;
    if (!fetched) {
      return {
        error: `Agent "${agentId}" was not found or you do not have access to it. Use an agent id from <available_agents>, <mentioned_agents> or searchAgent.`,
      };
    }
    getAgentStoreState().internal_dispatchAgentMap(agentId, fetched);
    config = fetched;
  }

  const title = (cachedMeta?.title ?? (config as { title?: string } | undefined)?.title) || agentId;

  if (config?.agencyConfig?.heterogeneousProvider) {
    return {
      error: `Agent "${title}" is an external agent (such as Claude Code). This conversation runs its tools in the app itself instead of on the server, where external agents are started, so it cannot be called from here. Answer yourself, or ask the user to call it directly.`,
    };
  }

  return { config: config as LobeAgentConfig, title };
};
