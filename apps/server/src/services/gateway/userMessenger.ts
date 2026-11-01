/**
 * Per-user messenger connections on the gateway (typing surface, polling links).
 */
import debug from 'debug';

import type { MessengerPlatform } from '@/config/messenger';
import { gatewayEnv } from '@/envs/gateway';
import {
  getInstallationStore,
  messengerConnectionIdForUser,
} from '@/server/services/messenger/installations';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';

import { getMessageGatewayClient, isAnyMessageGatewayEnabled } from './MessageGatewayClient';

/**
 * Per-user messenger gateway connections live on the gateway as webhook-mode
 * DOs that only exist to receive `startTyping` / `stopTyping`. We keep an
 * in-process map of `connectionId → expireAt` so a hot conversation only
 * triggers one `client.connect` per process per TTL window. LRU cap defends
 * against unbounded growth in a long-running replica with a wide active set.
 *
 * Module-scoped (not instance-scoped) because `new GatewayService()` is built
 * fresh on every call site — instance state would defeat the cache.
 */
const USER_MESSENGER_CONN_TTL_MS = 30 * 60 * 1000;
const USER_MESSENGER_CONN_LRU_CAPACITY = 5000;
const userMessengerConnections = new Map<string, number>();

export interface UserMessengerConnectionParams {
  installationKey: string;
  platform: MessengerPlatform;
  userId: string;
}

const log = debug('lobe-server:service:gateway');

/**
 * Lazy-register a per-user messenger connection on the gateway and return
 * the connectionId. Idempotent within the in-process LRU TTL — repeat calls
 * skip the network round-trip.
 *
 * Returns null when:
 *  - the gateway is disabled (`MESSAGE_GATEWAY_ENABLED !== '1'`)
 *  - the installation store can't resolve credentials for the given key
 *  - the gateway connect call throws (best-effort: messenger typing is a
 *    UX nicety, never block the agent run)
 *
 * Slack token rotation is handled passively by the LRU TTL: when a stale
 * cached entry expires, the next call re-resolves credentials via
 * `resolveByKey` (which transparently refreshes Slack OAuth) and pushes the
 * fresh token to the gateway via a fresh `connect`. The DO upserts on
 * connectionId so this is non-disruptive.
 */
export async function ensureUserMessengerConnected(
  params: UserMessengerConnectionParams,
): Promise<string | null> {
  if (!isAnyMessageGatewayEnabled()) return null;

  const { installationKey, platform, userId } = params;

  // Websocket-mode singleton platforms (Discord SystemBot today): the WS
  // is registered by dc-center at `messenger:<platform>:singleton` and
  // there is no per-user DO to register here. Route typing to the
  // singleton connectionId directly — opening a per-user webhook DO would
  // (a) be rejected by the gateway and (b) not be where `triggerTyping`
  // can actually fire, since only the singleton WS holds the live socket.
  //
  // SystemBot's transport is fixed per platform (e.g. Slack SystemBot is
  // webhook even though a per-agent bot-channel Slack provider may run
  // Socket Mode/websocket), so it lives on the messenger definition, not
  // the bot-channel one.
  const connectionMode = messengerPlatformRegistry.getPlatform(platform)?.connectionMode;
  if (connectionMode === 'websocket') {
    return messengerConnectionIdForUser({ connectionMode, installationKey, userId });
  }

  const connectionId = messengerConnectionIdForUser({ connectionMode, installationKey, userId });

  const now = Date.now();
  const expireAt = userMessengerConnections.get(connectionId);
  if (expireAt && expireAt > now) {
    // Re-touch on hit so the LRU eviction order tracks recency.
    userMessengerConnections.delete(connectionId);
    userMessengerConnections.set(connectionId, expireAt);
    return connectionId;
  }

  const store = getInstallationStore(platform);
  if (!store) {
    log('ensureUserMessengerConnected: no installation store for platform=%s', platform);
    return null;
  }

  const creds = await store.resolveByKey(installationKey);
  if (!creds?.botToken) {
    log(
      'ensureUserMessengerConnected: missing creds for key=%s (user=%s)',
      installationKey,
      userId,
    );
    return null;
  }

  try {
    const client = getMessageGatewayClient(platform);
    const isPolling = connectionMode === 'polling';
    await client.connect({
      applicationId: creds.applicationId,
      // Messenger-owned connections never consume passive channel
      // monitoring — the shared bot only reacts to DMs and explicit
      // mentions, so the gateway may drop ordinary channel messages.
      capabilities: { messageMonitoring: { enabled: false } },
      connectionId,
      // Webhook platforms only need an outbound typing surface. Polling
      // platforms (WeChat) own a real per-user inbound lifecycle and must
      // receive the complete QR-issued credential bundle.
      connectionMode: isPolling ? 'polling' : 'webhook',
      credentials: isPolling
        ? {
            baseUrl: creds.baseUrl,
            botId: creds.botId,
            botToken: creds.botToken,
            webhookToken: gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN,
          }
        : { botToken: creds.botToken },
      platform,
      userId,
      webhookPath: isPolling ? `/api/agent/messenger/webhooks/${platform}` : '',
    });

    // Evict-on-add: the iterator yields keys in insertion order, so the
    // first key is the oldest entry.
    if (userMessengerConnections.size >= USER_MESSENGER_CONN_LRU_CAPACITY) {
      const oldest = userMessengerConnections.keys().next().value;
      if (oldest !== undefined) userMessengerConnections.delete(oldest);
    }
    userMessengerConnections.set(connectionId, now + USER_MESSENGER_CONN_TTL_MS);

    log('ensureUserMessengerConnected: registered %s', connectionId);
    return connectionId;
  } catch (err) {
    log('ensureUserMessengerConnected: connect failed for %s: %O', connectionId, err);
    return null;
  }
}

/**
 * Stop a user-owned messenger connection during unlink or credential
 * replacement. Cleanup is allowed while the gateway feature flag is off so
 * a rollout rollback cannot strand a long-polling WeChat connection.
 */
export async function disconnectUserMessenger(
  params: UserMessengerConnectionParams,
): Promise<void> {
  const { installationKey, platform, userId } = params;
  const connectionMode = messengerPlatformRegistry.getPlatform(platform)?.connectionMode;
  if (connectionMode === 'websocket') return;

  const connectionId = messengerConnectionIdForUser({ connectionMode, installationKey, userId });
  userMessengerConnections.delete(connectionId);

  const client = getMessageGatewayClient(platform);
  if (!client.isConfigured) return;

  try {
    await client.disconnect(connectionId);
    log('disconnectUserMessenger: disconnected %s', connectionId);
  } catch (error) {
    log('disconnectUserMessenger: failed for %s: %O', connectionId, error);
  }
}
