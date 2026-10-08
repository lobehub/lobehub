import { CLIENT_LLM_WAIT_CAPABILITY, LLM_RELAY_CAPABILITY } from '@lobechat/agent-gateway-client';
import type { ExecAgentLlmExecutor } from '@lobechat/types';

import { initializeWithClientStore } from '@/services/chat/mecha/clientModelRuntime';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { getServerConfigStoreState } from '@/store/serverConfig';

import { getLlmRelayClientId } from './clientId';
import { LlmRelayExecutor } from './executor';

export { getLlmRelayClientId } from './clientId';
export type { ExecuteRelayCallOptions } from './executor';

/**
 * The page-wide relay executor. Runs on this client's own provider
 * configuration (key vaults, base URL), exactly like the client-side fetch
 * path of `chatService`.
 */
export const llmRelayExecutor = new LlmRelayExecutor({
  createRuntime: ({ payload, provider, runtimeProvider }) =>
    initializeWithClientStore({ payload, provider, runtimeProvider }),
});

const isLlmRelayEnabled = () => {
  const state =
    (typeof window !== 'undefined' ? window.global_serverConfigStore?.getState() : undefined) ??
    getServerConfigStoreState();
  return !!state?.featureFlags?.enableLlmRelay;
};

/**
 * `execAgent`'s `llmExecutor`: this client can run relayed LLM attempts for
 * the providers it has configured. The server still decides per provider
 * whether a call needs the device at all (`fetchOnClient`, a private base
 * URL). Absent outside the `agent_llm_relay` rollout.
 */
export const buildLlmExecutorDeclaration = (): ExecAgentLlmExecutor | undefined => {
  if (!isLlmRelayEnabled()) return;

  // The runtime state every chat surface loads (the full `aiProviderList` is
  // only fetched by the provider settings page).
  const providers = (getAiInfraStoreState().enabledAiProviders ?? [])
    .map((provider) => provider.id)
    .slice(0, 256);

  return {
    capabilities: [LLM_RELAY_CAPABILITY, CLIENT_LLM_WAIT_CAPABILITY],
    clientId: getLlmRelayClientId(),
    providers,
  };
};

/**
 * This client's executor declaration when it covers `provider`, i.e. it can
 * pick up a run parked in `waiting_for_client` for that provider.
 */
export const getLlmExecutorDeclarationFor = (
  provider: string | undefined,
): ExecAgentLlmExecutor | undefined => {
  if (!provider) return;
  const declaration = buildLlmExecutorDeclaration();
  return declaration?.providers.includes(provider) ? declaration : undefined;
};
