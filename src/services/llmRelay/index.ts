import { CLIENT_LLM_WAIT_CAPABILITY, LLM_RELAY_CAPABILITY } from '@lobechat/agent-gateway-client';
import type { ExecAgentLlmExecutor } from '@lobechat/types';

import { initializeWithClientStore } from '@/services/chat/mecha/clientModelRuntime';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { subscribeLlmRelayChannel } from './channelSubscription';
import { getLlmRelayClientId } from './clientId';
import { LlmRelayExecutor } from './executor';
import { OneShotRelay } from './oneShot';

export { getLlmRelayClientId } from './clientId';
export type { ExecuteRelayCallOptions } from './executor';
export type { OneShotRelayHandle } from './oneShot';

/**
 * The page-wide relay executor. Runs on this client's own provider
 * configuration (key vaults, base URL), exactly like the client-side fetch
 * path of `chatService`.
 */
export const llmRelayExecutor = new LlmRelayExecutor({
  createRuntime: ({ payload, provider, runtimeProvider }) =>
    initializeWithClientStore({ payload, provider, runtimeProvider }),
});

const getConfigState = () =>
  (typeof window !== 'undefined' ? window.global_serverConfigStore?.getState() : undefined) ??
  getServerConfigStoreState();

const isLlmRelayEnabled = () => !!getConfigState()?.featureFlags?.enableLlmRelay;

/**
 * The page-wide one-shot relay: LLM calls this tab asks the server for (preset
 * tasks, structured output, model lists) whose provider only this device can
 * reach are relayed back here instead of being called from the browser.
 * Active only within the `agent_llm_relay` rollout on a deployment that can
 * relay (Agent Gateway + Redis); elsewhere `oneShotRelay.run` just makes the
 * request.
 */
export const oneShotRelay = new OneShotRelay({
  // `llmRelayAvailable`: the server can relay (gateway + Redis); otherwise it
  // would call a device-only provider itself, so keep the browser path.
  isAvailable: () => {
    const serverConfig = getConfigState()?.serverConfig;
    return (
      isLlmRelayEnabled() && !!serverConfig?.agentGatewayUrl && !!serverConfig.llmRelayAvailable
    );
  },
  isDeviceProvider: (provider) =>
    aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState()),
  onCancel: (data) => llmRelayExecutor.cancel(data),
  onExecute: (data) => void llmRelayExecutor.execute(data),
  subscribe: (channel, onEvent) => {
    const subscription = subscribeLlmRelayChannel(
      getConfigState()!.serverConfig!.agentGatewayUrl!,
      channel,
      onEvent,
    );
    return subscription.then((sub) => ({
      ...sub,
      close: () => {
        // The request is over: whatever it left running on this tab is moot.
        llmRelayExecutor.cancelOperation(channel);
        sub.close();
      },
    }));
  },
  userId: () => userProfileSelectors.userId(useUserStore.getState()),
});

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
