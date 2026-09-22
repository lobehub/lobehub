import { getServerConfigStoreState } from '@/store/serverConfig';

/**
 * `serverConfig` / `featureFlags`, read the same way the gateway transport does:
 * the global store first (the SPA and the desktop shell publish it on `window`
 * before the React store exists), then the module-level state.
 */
const getConfigState = () =>
  (typeof window !== 'undefined' ? window.global_serverConfigStore?.getState() : undefined) ??
  getServerConfigStoreState();

/**
 * Whether this client speaks protocol v2 to the Agent Gateway: one multiplexed
 * socket per user, message revisions instead of pushed message snapshots, and
 * projected tool payloads on the conversation read.
 *
 * Two independent halves, both required:
 *
 * - `agentGatewayProtocol === 2` — the deployment's gateway actually exposes
 *   `/v2/ws`. A capability, not a choice: there is no negotiation on the socket,
 *   and a self-hosted gateway that only has `/ws` cannot serve any of this.
 * - `enableGatewayMux` — this user is inside the rollout. Server-published, so
 *   it moves without a deploy and takes everything protocol v2 changes with it,
 *   in one step and in one direction.
 *
 * Read non-reactively: a run keeps the protocol it started with even if either
 * half changes underneath it.
 */
export const canUseGatewayProtocolV2 = (): boolean => {
  const state = getConfigState();

  return state?.serverConfig?.agentGatewayProtocol === 2 && !!state.featureFlags?.enableGatewayMux;
};
