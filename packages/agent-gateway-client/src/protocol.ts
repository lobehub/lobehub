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

// ─── One-shot relay (an LLM call outside any agent run) ───

/**
 * Prefix of a one-shot relay channel id: `llmcall:<userId>:<nonce>`. The tab
 * that makes the call generates the id, subscribes to it on the gateway, and
 * hands it to the server in {@link LLM_RELAY_CHANNEL_HEADER}; the server opens
 * the channel and dispatches the call's `llm_execute` on it. The user id in the
 * id keeps a caller from making the server open a channel it does not own.
 */
export const LLM_RELAY_CHANNEL_PREFIX = 'llmcall:';

/** Request header: the one-shot channel this tab subscribed to for the call. */
export const LLM_RELAY_CHANNEL_HEADER = 'x-lobe-llm-relay-channel';

/** Request header: this tab's client id (`getLlmRelayClientId`), the call's preferred executor. */
export const LLM_RELAY_CLIENT_ID_HEADER = 'x-lobe-client-id';

const CHANNEL_NONCE = /^[\w-]{8,64}$/;

export const buildLlmRelayChannelId = (userId: string, nonce: string) =>
  `${LLM_RELAY_CHANNEL_PREFIX}${userId}:${nonce}`;

export const isLlmRelayChannelId = (operationId: string | undefined): boolean =>
  !!operationId?.startsWith(LLM_RELAY_CHANNEL_PREFIX);

/**
 * Whether `channel` is a well-formed one-shot channel id of `userId`. The
 * server opens only such channels: anything else could name a real run's
 * operation or another user's channel.
 */
export const isOwnLlmRelayChannelId = (channel: string, userId: string): boolean => {
  const prefix = buildLlmRelayChannelId(userId, '');
  return channel.startsWith(prefix) && CHANNEL_NONCE.test(channel.slice(prefix.length));
};

/**
 * The scope a channel that outlives one request (a sub-agent's relay) is bound
 * to: the workspace the dispatching request runs in, `personal` outside one.
 * It leads the nonce (`<scope>-<random>`), so a request in one workspace cannot
 * name the same user's channel of another workspace, whose tab relays with
 * that workspace's providers.
 */
export const llmRelayChannelScope = (workspaceId?: string | null): string =>
  workspaceId || 'personal';

/** Whether `channel` is `userId`'s own channel bound to `workspaceId`'s scope. */
export const isScopedLlmRelayChannelId = (
  channel: string,
  userId: string,
  workspaceId?: string | null,
): boolean =>
  isOwnLlmRelayChannelId(channel, userId) &&
  channel
    .slice(buildLlmRelayChannelId(userId, '').length)
    .startsWith(`${llmRelayChannelScope(workspaceId)}-`);
