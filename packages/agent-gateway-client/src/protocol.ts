/**
 * Highest wire protocol this bundle speaks to the Agent Gateway and to the run
 * that feeds it. Sent when a run starts (`clientProtocol`) — subject to the
 * rollout gate, see `canUseGatewayProtocolV2` — so the run may deliver message
 * revisions (`message_patch`) instead of whole `uiMessages` snapshots. A client
 * that sends nothing is treated as protocol 1 and keeps the snapshots.
 *
 * Bump this only together with the client-side handling of whatever the new
 * version lets the server omit — a desktop build lags the server by weeks, and
 * this constant is exactly what tells the two apart.
 */
export const CLIENT_PROTOCOL_VERSION = 2 as const;

/**
 * LLM relay protocol a client declares in `execAgent`'s `llmExecutor` when it
 * can run relayed LLM attempts (`llm_execute`). The server relays only to a
 * client that declares a version it speaks.
 */
export const LLM_RELAY_CAPABILITY = 'llm_relay@1';

/**
 * Declared alongside {@link LLM_RELAY_CAPABILITY} by a client that keeps a run
 * open while it waits for a client (`waiting_for_client`) instead of treating
 * the parked call's error as the run's end. The server parks a run its
 * declaring client started only if that client speaks this.
 */
export const CLIENT_LLM_WAIT_CAPABILITY = 'llm_client_wait@1';

/** Header carrying the per-call lease token on the relay endpoints. */
export const LLM_RELAY_LEASE_HEADER = 'x-llm-relay-lease';
