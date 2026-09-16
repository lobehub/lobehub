import { isLocalOrPrivateUrl } from '@lobechat/utils/url';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';

/**
 * Whether a model provider can only be reached from the device that issues the
 * request — a local inference server (LM Studio, Ollama, vLLM, …) published on
 * a loopback or private-network endpoint that the user asked to call directly
 * from their client.
 *
 * Both halves matter:
 * - `fetchOnClient` is the user's (or the provider card's) declaration that the
 *   request belongs on this device. Without it the deployment's own server is
 *   the intended caller and may well reach the endpoint.
 * - a loopback / private-network `baseURL` is only meaningful on the machine
 *   that dials it, so no remote runtime can serve it.
 *
 * The provider connectivity check always runs through `chatService` on this
 * device, so it succeeds for such a provider while a server-side run fails with
 * a bare "Connection error." — see `selectRuntimeType` (#19526).
 */
export const isLocalOnlyModelProvider = (provider?: string): boolean => {
  if (!provider) return false;

  const aiInfraState = getAiInfraStoreState();
  if (!aiProviderSelectors.isProviderFetchOnClient(provider)(aiInfraState)) return false;

  const keyVaults = aiProviderSelectors.providerKeyVaults(provider)(aiInfraState);
  const baseURL = keyVaults?.baseURL || keyVaults?.endpoint;

  return !!baseURL && isLocalOrPrivateUrl(baseURL);
};

/**
 * {@link isLocalOnlyModelProvider} for the model an agent is configured with.
 * Falls back to the active agent when no id is given, matching the other
 * runtime-selection inputs.
 */
export const isLocalOnlyModelProviderForAgent = (agentId?: string): boolean => {
  const agentState = getAgentStoreState();
  const resolvedAgentId = agentId ?? agentState.activeAgentId;
  if (!resolvedAgentId) return false;

  return isLocalOnlyModelProvider(
    agentSelectors.getAgentConfigById(resolvedAgentId)(agentState)?.provider,
  );
};
