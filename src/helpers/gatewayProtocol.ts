import { getServerConfigStoreState } from '@/store/serverConfig';

/**
 * `serverConfig`, read the same way the gateway transport does: the global
 * store first (the SPA and the desktop shell publish it on `window` before the
 * React store exists), then the module-level state.
 */
const getConfigState = () =>
  (typeof window !== 'undefined' ? window.global_serverConfigStore?.getState() : undefined) ??
  getServerConfigStoreState();

/**
 * Whether this client speaks protocol v2 to the Agent Gateway: one multiplexed
 * socket per user, message revisions instead of pushed message snapshots, and
 * projected tool payloads on the conversation read.
 *
 * Decided by `agentGatewayProtocol === 2` alone — the deployment's gateway
 * actually exposes `/v2/ws`. A capability, not a choice: there is no
 * negotiation on the socket, and a self-hosted gateway that only has `/ws`
 * cannot serve any of this.
 *
 * Read non-reactively: a run keeps the protocol it started with even if the
 * server config changes underneath it.
 */
export const canUseGatewayProtocolV2 = (): boolean =>
  getConfigState()?.serverConfig?.agentGatewayProtocol === 2;
