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
