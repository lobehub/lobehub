import debug from 'debug';
import pMap from 'p-map';

import {
  assertBotFeatureAccess,
  getBotFeatureBlockedMessage,
  isBotFeatureAccessAllowed,
} from '@/business/server/bot/featureAccess';
import type { MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import {
  AgentBotProviderModel,
  type DecryptedBotProvider,
} from '@/database/models/agentBotProvider';
import { gatewayEnv } from '@/envs/gateway';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  getInstallationStore,
  isMessengerConnectionId,
  messengerConnectionIdForUser,
} from '@/server/services/messenger/installations';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';
import { type BotRuntimeStatus, type BotRuntimeStatusSnapshot } from '@/types/botRuntimeStatus';

import type { ConnectionMode } from '../bot/platforms';
import {
  extractWatchKeywordEntries,
  platformRegistry,
  resolveConnectionMode,
} from '../bot/platforms';
import { BOT_CONNECT_QUEUE_EXPIRE_MS, BotConnectQueue } from './botConnectQueue';
import { createGatewayManager, getGatewayManager } from './GatewayManager';
import {
  getMessageGatewayClient,
  type MessageGatewayCapabilities,
  type MessageGatewayConnectionStatus,
} from './MessageGatewayClient';
import { BOT_RUNTIME_STATUSES, getBotRuntimeStatus, updateBotRuntimeStatus } from './runtimeStatus';

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

/**
 * Cap on concurrent gateway calls during reconciliation. The gateway fans out
 * to one Durable Object per connection, so bursts mostly stress the Worker
 * router — this is about keeping the sync's own fetch fan-out (and DB status
 * writes) bounded as the connection count grows.
 */
const GATEWAY_SYNC_CONCURRENCY = 8;

/**
 * Blast-radius cap for the stale-connection disconnect pass: even with
 * cleanup enforced, one sync round disconnects at most this many connections.
 * A desired-set bug can then cost one bounded, observable batch per cron round
 * instead of the whole fleet; genuine mass cleanup still converges over a few
 * rounds.
 */
const GATEWAY_SYNC_STALE_DISCONNECT_LIMIT = 50;

/**
 * Cap on registered-only wake-up connects per sync round. A registered-only id
 * (in the registry but pruned from live stats) is usually a parked or
 * self-waking dormant DO, but a stranded DO — alarm chain lost after a deploy
 * cancelled its in-flight alarm invocation — looks identical and sleeps
 * forever unless something wakes it. The `ensure` connect is that wake: parked
 * connections answer 409 and keep their park, healthy ones no-op. The cap
 * keeps a large parked backlog from turning every cron round into a fleet-wide
 * wake storm; the remainder is retried on later rounds.
 */
const GATEWAY_SYNC_REGISTERED_ONLY_WAKE_LIMIT = 50;

/**
 * Uniformly sample up to `limit` ids via a partial Fisher-Yates shuffle.
 * Stateless by design — the gateway cron runs in fresh serverless invocations,
 * so a persisted round-robin cursor would need external storage; uniform
 * sampling gives every candidate an expected candidates/limit-round latency
 * without any state.
 */
const sampleIds = (ids: string[], limit: number): Set<string> => {
  if (ids.length <= limit) return new Set(ids);
  const pool = [...ids];
  const picked = new Set<string>();
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    picked.add(pool[i]);
  }
  return picked;
};

interface DesiredGatewayConnection {
  connectionMode: ConnectionMode;
  platform: string;
  provider: DecryptedBotProvider;
}

interface ActualConnectionsSnapshot {
  /**
   * True when registered ids were loaded successfully, making absence from
   * `connections` authoritative. False means the snapshot only covers live
   * stats, so dormant/hibernated connections may be missing from the map.
   */
  complete: boolean;
  /** connectionId → gateway status, or null for registered-only (pruned) ids. */
  connections: Map<string, string | null>;
}

function mapGatewayStatusToRuntimeStatus(
  status: MessageGatewayConnectionStatus['state']['status'],
): BotRuntimeStatus {
  switch (status) {
    case 'connected': {
      return BOT_RUNTIME_STATUSES.connected;
    }
    case 'connecting': {
      return BOT_RUNTIME_STATUSES.starting;
    }
    case 'disconnected': {
      return BOT_RUNTIME_STATUSES.disconnected;
    }
    case 'dormant': {
      return BOT_RUNTIME_STATUSES.dormant;
    }
    case 'error': {
      return BOT_RUNTIME_STATUSES.failed;
    }
  }
}

const log = debug('lobe-server:service:gateway');

/**
 * Derive edge-filtering capabilities for a bot-channel connection from its
 * settings. Monitoring is enabled purely by "has watch keywords configured":
 * feature-access gating stays server-side (BotMessageRouter), so access
 * changes never require a gateway reconnect and operators with existing
 * rules are never cut off by a stale edge config.
 */
const resolveBotGatewayCapabilities = (
  settings?: Record<string, unknown> | null,
): MessageGatewayCapabilities => ({
  messageMonitoring: { enabled: extractWatchKeywordEntries(settings ?? undefined).length > 0 },
});

const isVercel = !!process.env.VERCEL_ENV;

export class GatewayService {
  /**
   * Whether to use the external message-gateway for connection management.
   * Requires MESSAGE_GATEWAY_ENABLED=1 plus URL/TOKEN to be configured.
   * This allows disabling the gateway (for migration) while keeping
   * the client reachable for cleanup.
   */
  get useMessageGateway(): boolean {
    return getMessageGatewayClient().isEnabled;
  }

  async ensureRunning(): Promise<void> {
    if (this.useMessageGateway) {
      await this.syncGatewayConnections();
      return;
    }

    const existing = getGatewayManager();
    if (existing?.isRunning) {
      log('GatewayManager already running');
      return;
    }

    // Start local connections first, then clean up gateway —
    // brief overlap is better than a gap where messages are lost.
    const manager = createGatewayManager({ definitions: platformRegistry.listPlatforms() });
    await manager.start();
    log('GatewayManager started');

    // Clean up leftover gateway connections to prevent duplicates.
    const client = getMessageGatewayClient();
    if (client.isConfigured) {
      try {
        const result = await client.disconnectAll();
        if (result.total > 0) {
          log('Cleaned up %d gateway connections', result.total);
        }
      } catch (err) {
        log('Gateway cleanup skipped (non-critical): %O', err);
      }
    }
  }

  /**
   * Reconcile the external message-gateway against the database.
   *
   * Desired state = enabled persistent-mode providers whose owner passes the
   * bot feature gate. Actual state = every connection the gateway still holds
   * (live stats ∪ registered ids). The diff runs both ways:
   *
   *  - actual − desired → disconnect. Covers deleted/disabled providers,
   *    downgraded owners, and providers switched to webhook mode — the stale
   *    connections that a connect-only sync never visits.
   *  - desired − actual → connect (unless the gateway reports the connection
   *    as connected/connecting/dormant/error).
   *
   * Called from the gateway cron; also recovers connections after restarts.
   */
  private async syncGatewayConnections(): Promise<void> {
    const startedAt = Date.now();
    const client = getMessageGatewayClient();
    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    const { desired, desiredComplete, gated } = await this.buildDesiredConnections(
      serverDB,
      gateKeeper,
    );

    const actual = await this.fetchActualConnections(client);
    const gatedDisconnected = await this.disconnectGatedConnections(client, actual, gated);

    // A partial desired set would make healthy connections look stale, so only
    // run the disconnect pass when every platform loaded successfully. A
    // partial ACTUAL set is fine — the pass only disconnects ids it can see.
    let stale = 0;
    if (actual && desiredComplete) {
      stale = await this.disconnectStaleConnections(
        client,
        serverDB,
        actual.connections,
        desired,
        gated,
      );
    } else if (actual) {
      log('Gateway sync: desired set incomplete, skipping stale-connection cleanup this round');
    }

    // ── desired − actual → connect ──

    let connected = 0;
    let deferred = 0;
    let skipped = 0;
    let failed = 0;

    // Registered-only wake candidates are SAMPLED, not taken head-first: the
    // desired map iterates in a stable order, and parked connections (409,
    // stay registered-only until their 7d expiry) would otherwise burn the
    // whole cap on the same prefix every round, starving stranded DOs that
    // sort after position N. Uniform sampling reaches every candidate within
    // an expected candidates/limit rounds with no persisted cursor.
    const registeredOnlyCandidates = [...desired.values()]
      .map(({ provider }) => provider.id)
      .filter(
        (id) => (actual?.connections.has(id) ?? false) && actual?.connections.get(id) === null,
      );
    const registeredOnlyWakeIds = sampleIds(
      registeredOnlyCandidates,
      GATEWAY_SYNC_REGISTERED_ONLY_WAKE_LIMIT,
    );
    const registeredOnlyDeferred = registeredOnlyCandidates.length - registeredOnlyWakeIds.size;
    let registeredOnlyWakes = 0;

    await pMap(
      desired.values(),
      async ({ connectionMode, platform, provider }) => {
        try {
          // Credentials missing/undecryptable: the provider is still desired
          // (protected from the stale pass) but a connect attempt can only
          // fail — leave whatever connection state the gateway already holds.
          if (Object.keys(provider.credentials).length === 0) {
            skipped++;
            log('Gateway sync: %s credentials unavailable, skipping connect', provider.id);
            return;
          }

          // Registered ids are the gateway's authoritative existence set. Use
          // the status already present in live stats to recover an explicitly
          // disconnected connection. Registered-only ids (status null — pruned
          // from stats) get a capped ensure-connect wake instead of a skip:
          // see GATEWAY_SYNC_REGISTERED_ONLY_WAKE_LIMIT. Never probe per-DO
          // status here.
          const exists = actual?.connections.has(provider.id) ?? false;
          const snapshotStatus = actual?.connections.get(provider.id);
          if (exists && snapshotStatus !== 'disconnected') {
            if (snapshotStatus !== null) {
              skipped++;
              log('Gateway sync: %s already registered, skipping', provider.id);
              return;
            }
            if (!registeredOnlyWakeIds.has(provider.id)) {
              log(
                'Gateway sync: %s registered-only, not sampled this round, deferring',
                provider.id,
              );
              return;
            }
            registeredOnlyWakes++;
            log('Gateway sync: %s registered-only, ensure-waking', provider.id);
          }

          // Without a complete registry snapshot, absence from live stats does
          // not prove the connection is missing. Fail safe and retry next round
          // instead of degrading to an unbounded per-DO status probe fan-out.
          if (!exists && !actual?.complete) {
            deferred++;
            log('Gateway sync: %s absent from incomplete snapshot, deferring', provider.id);
            return;
          }

          if (snapshotStatus === 'disconnected') {
            log('Gateway sync: %s reported disconnected in stats, reconnecting', provider.id);
          }

          const webhookPath = `/api/agent/webhooks/${platform}/${provider.applicationId}`;
          // `ensure` marks this as a reconcile connect: the gateway preserves
          // its park/backoff state when the config is unchanged (a parked
          // connection answers 409 → counted as failed below), instead of
          // letting every sync round reset stuck connections to fast retry.
          const result = await client.connect(
            {
              applicationId: provider.applicationId,
              capabilities: resolveBotGatewayCapabilities(provider.settings),
              connectionId: provider.id,
              connectionMode,
              credentials: provider.credentials,
              platform,
              userId: provider.userId,
              webhookPath,
            },
            { ensure: true },
          );

          // Gateway returns "connecting" for async persistent connections
          // (e.g. Discord WebSocket), "connected" for sync webhook-mode. An
          // `ensure` reconcile can also legitimately return "dormant" (the DO is
          // sparse-polling and won't send a correcting callback), so map through
          // the shared helper instead of collapsing every non-connected result
          // to "starting" — otherwise a dormant connection is persisted as
          // starting and never corrected.
          await updateBotRuntimeStatus({
            applicationId: provider.applicationId,
            platform,
            status: mapGatewayStatusToRuntimeStatus(result.status),
          });

          connected++;
          log('Gateway sync: %s %s:%s', result.status, platform, provider.applicationId);
        } catch (err) {
          failed++;
          log('Gateway sync: failed to connect %s:%s: %O', platform, provider.applicationId, err);
        }
      },
      { concurrency: GATEWAY_SYNC_CONCURRENCY },
    );

    log(
      'Gateway sync complete in %dms: desired=%d actual=%s snapshotComplete=%s connected=%d skipped=%d deferred=%d gated=%d gatedDisconnected=%d stale=%d failed=%d registeredOnlyWakes=%d registeredOnlyDeferred=%d',
      Date.now() - startedAt,
      desired.size,
      actual ? actual.connections.size : 'unavailable',
      actual?.complete ?? false,
      connected,
      skipped,
      deferred,
      gated.size,
      gatedDisconnected,
      stale,
      failed,
      registeredOnlyWakes,
      registeredOnlyDeferred,
    );
  }

  /**
   * Build the set of connections that SHOULD exist on the gateway: enabled
   * persistent-mode providers whose owner passes the bot feature gate.
   *
   * Paid-gated providers are tracked separately and excluded from the desired
   * set so the caller can disconnect only ids the gateway still holds. If the
   * gate check itself errors, the provider is kept in desired — a flaky
   * subscription lookup must not tear down a healthy connection.
   */
  private async buildDesiredConnections(
    serverDB: Awaited<ReturnType<typeof getServerDB>>,
    gateKeeper: KeyVaultsGateKeeper,
  ): Promise<{
    desired: Map<string, DesiredGatewayConnection>;
    desiredComplete: boolean;
    gated: Set<string>;
  }> {
    const desired = new Map<string, DesiredGatewayConnection>();
    let desiredComplete = true;
    const gated = new Set<string>();

    for (const definition of platformRegistry.listPlatforms()) {
      const platform = definition.id;
      try {
        // includeUndecryptable: rows whose credentials can't be decrypted stay
        // in the desired set (with empty credentials) so a KEY_VAULTS_SECRET
        // mishap degrades to "no reconnects" instead of mass-disconnecting
        // every healthy connection as stale.
        const providers = await AgentBotProviderModel.findEnabledByPlatform(
          serverDB,
          platform,
          gateKeeper,
          { includeUndecryptable: true },
        );

        for (const provider of providers) {
          const connectionMode = resolveConnectionMode(definition, provider.settings);

          // Webhook-mode platforms don't need persistent gateway connections.
          // The webhook URL is set once when the user saves the bot config
          // (via startClientViaGateway). No action needed during periodic sync.
          if (connectionMode === 'webhook') continue;

          let allowed = true;
          try {
            allowed = await isBotFeatureAccessAllowed({
              applicationId: provider.applicationId,
              platform,
              userId: provider.userId,
              workspaceId: provider.workspaceId ?? undefined,
            });
          } catch (err) {
            log(
              'Gateway sync: feature gate check failed %s, keeping connection: %O',
              provider.id,
              err,
            );
          }

          if (!allowed) {
            gated.add(provider.id);
            await updateBotRuntimeStatus({
              applicationId: provider.applicationId,
              errorMessage: getBotFeatureBlockedMessage(
                platform,
                provider.workspaceId ? 'workspace' : 'personal',
              ),
              platform,
              status: BOT_RUNTIME_STATUSES.failed,
            });
            log(
              'Gateway sync: paid-gated %s:%s, excluded from desired set',
              platform,
              provider.applicationId,
            );
            continue;
          }

          desired.set(provider.id, { connectionMode, platform, provider });
        }
      } catch (err) {
        desiredComplete = false;
        log('Gateway sync: error loading providers for platform %s: %O', platform, err);
      }
    }

    return { desired, desiredComplete, gated };
  }

  /**
   * With a complete registry snapshot, disconnect paid-gated providers only
   * when the connection still exists. When the snapshot is partial or
   * unavailable, preserve access enforcement by falling back to disconnecting
   * every gated id; that bounded set is independent of the desired-connection
   * status fan-out this reconciliation avoids.
   */
  private async disconnectGatedConnections(
    client: ReturnType<typeof getMessageGatewayClient>,
    actual: ActualConnectionsSnapshot | null,
    gated: Set<string>,
  ): Promise<number> {
    const connectionIds = actual?.complete
      ? [...gated].filter((id) => actual.connections.has(id))
      : [...gated];
    let disconnected = 0;

    await pMap(
      connectionIds,
      async (id) => {
        try {
          await client.disconnect(id);
          disconnected++;
          log('Gateway sync: paid-gated connection %s disconnected', id);
        } catch (err) {
          log('Gateway sync: paid-gated disconnect failed %s: %O', id, err);
        }
      },
      { concurrency: GATEWAY_SYNC_CONCURRENCY },
    );

    return disconnected;
  }

  /**
   * Snapshot the gateway's view of existing connections: live stats (with
   * status) unioned with registered ids (dormant/hibernated connections the
   * AdminDO stats already pruned — status unknown, hence `null`).
   *
   * Registered ids are the authoritative existence set, so a successful call
   * produces a complete snapshot even when stats are unavailable. When only
   * stats succeed, the partial snapshot can still drive safe stale cleanup,
   * but desired ids missing from it are deferred rather than probed one by one.
   * Returns null only when neither endpoint is available.
   */
  private async fetchActualConnections(
    client: ReturnType<typeof getMessageGatewayClient>,
  ): Promise<ActualConnectionsSnapshot | null> {
    const connections = new Map<string, string | null>();
    let statsAvailable = false;

    try {
      const stats = await client.getStats();
      statsAvailable = true;
      for (const conn of stats.connections) {
        connections.set(conn.connectionId, conn.state.status);
      }
    } catch (err) {
      log('Gateway sync: failed to fetch gateway stats snapshot: %O', err);
    }

    try {
      const { ids } = await client.getRegisteredIds();
      for (const id of ids) {
        if (!connections.has(id)) connections.set(id, null);
      }
      return { complete: true, connections };
    } catch (err) {
      log('Gateway sync: registered-ids unavailable, using stats-only snapshot: %O', err);
    }

    return statsAvailable ? { complete: false, connections } : null;
  }

  /**
   * actual − desired → disconnect: connections the gateway still holds whose
   * provider was deleted, disabled, or no longer wants a persistent
   * connection. Messenger-owned connections (per-user typing DOs, SystemBot
   * singletons) carry the `messenger:` prefix and are managed elsewhere —
   * never touch them here.
   */
  private async disconnectStaleConnections(
    client: ReturnType<typeof getMessageGatewayClient>,
    serverDB: Awaited<ReturnType<typeof getServerDB>>,
    actual: Map<string, string | null>,
    desired: Map<string, DesiredGatewayConnection>,
    gated: Set<string>,
  ): Promise<number> {
    const allStaleIds = [...actual.keys()].filter(
      (id) => !desired.has(id) && !gated.has(id) && !isMessengerConnectionId(id),
    );
    if (allStaleIds.length === 0) return 0;

    const staleIds = allStaleIds.slice(0, GATEWAY_SYNC_STALE_DISCONNECT_LIMIT);
    if (staleIds.length < allStaleIds.length) {
      log(
        'Gateway sync: capping stale disconnects to %d of %d this round',
        staleIds.length,
        allStaleIds.length,
      );
    }

    // Fresh provider rows drive the TOCTOU guard and the status writes below.
    // If the recheck itself fails, treating it as "no rows" would bypass both
    // guards and could tear down a provider enabled mid-sync — skip the whole
    // pass instead; next round retries with a healthy lookup.
    const rows = await AgentBotProviderModel.findByIds(serverDB, staleIds).catch((err) => {
      log('Gateway sync: stale provider recheck failed, skipping cleanup this round: %O', err);
      return null;
    });
    if (!rows) return 0;
    const rowById = new Map(rows.map((row) => [row.id, row]));

    let disconnected = 0;

    await pMap(
      staleIds,
      async (id) => {
        try {
          const row = rowById.get(id);

          // TOCTOU guard: a provider enabled (and connected) between the
          // desired snapshot and the actual fetch shows up in `actual` but not
          // in `desired`. These rows were queried after both snapshots, so
          // trust them: an enabled persistent-mode row is not stale — leave it
          // for the next round to classify with a fresh desired set.
          if (
            row?.enabled &&
            resolveConnectionMode(platformRegistry.getPlatform(row.platform), row.settings) !==
              'webhook'
          ) {
            log('Gateway sync: %s enabled during sync, skipping stale disconnect', id);
            return;
          }

          await client.disconnect(id);
          disconnected++;

          // Only disabled rows get their runtime snapshot marked
          // disconnected. After the guard above, the remaining enabled rows
          // are webhook-mode: they just lost their old persistent DO, but the
          // webhook registration is what serves them now — and webhook-mode
          // refreshes return the cached snapshot, so overwriting it would
          // make a working channel look disconnected.
          if (row && !row.enabled) {
            await updateBotRuntimeStatus({
              applicationId: row.applicationId,
              platform: row.platform,
              status: BOT_RUNTIME_STATUSES.disconnected,
            });
          }
          log(
            'Gateway sync: disconnected stale connection %s (%s)',
            id,
            row ? (row.enabled ? 'webhook-mode provider' : 'disabled provider') : 'no provider row',
          );
        } catch (err) {
          log('Gateway sync: failed to disconnect stale connection %s: %O', id, err);
        }
      },
      { concurrency: GATEWAY_SYNC_CONCURRENCY },
    );

    return disconnected;
  }

  async stop(): Promise<void> {
    const manager = getGatewayManager();
    if (!manager) return;

    await manager.stop();
    log('GatewayManager stopped');
  }

  async startClient(
    platform: string,
    applicationId: string,
    userId: string,
  ): Promise<'started' | 'queued'> {
    if (this.useMessageGateway) {
      return this.startClientViaGateway(platform, applicationId, userId);
    }

    // ─── Legacy: in-process connection management ───
    if (isVercel) {
      // Load the provider so we can resolve per-provider connection mode.
      // The platform default is only a fallback — Slack/Feishu (default websocket)
      // can be configured for webhook mode per provider, and vice versa.
      const definition = platformRegistry.getPlatform(platform);
      const serverDB = await getServerDB();
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
        serverDB,
        platform,
        applicationId,
        gateKeeper,
      );

      const connectionMode = resolveConnectionMode(definition, provider?.settings);

      if (provider) {
        await assertBotFeatureAccess({
          action: 'manage',
          applicationId,
          platform,
          userId: provider.userId,
          workspaceId: provider.workspaceId ?? undefined,
        });
      }

      if (connectionMode !== 'webhook') {
        // Persistent platforms (e.g. Discord gateway or WeChat long-polling) cannot run in a
        // serverless function — queue for the long-running cron gateway.
        const queue = new BotConnectQueue();
        await queue.push(platform, applicationId, userId);
        await updateBotRuntimeStatus(
          {
            applicationId,
            platform,
            status: BOT_RUNTIME_STATUSES.queued,
          },
          {
            ttlMs: BOT_CONNECT_QUEUE_EXPIRE_MS,
          },
        );
        log('Queued connect %s:%s', platform, applicationId);
        return 'queued';
      }

      const manager = createGatewayManager({ definitions: platformRegistry.listPlatforms() });
      await manager.startClient(platform, applicationId);
      log('Started client %s:%s (direct)', platform, applicationId);
      return 'started';
    }

    let manager = getGatewayManager();
    if (!manager?.isRunning) {
      log('GatewayManager not running, starting automatically...');
      await this.ensureRunning();
      manager = getGatewayManager();
    }

    await manager!.startClient(platform, applicationId);
    log('Started client %s:%s', platform, applicationId);
    return 'started';
  }

  /**
   * Pull live status from the gateway for every enabled provider under an
   * agent and persist each result to Redis. No-op when the gateway is
   * disabled; webhook-mode providers are skipped (they have no persistent
   * gateway connection to query).
   */
  async refreshBotRuntimeStatusesByAgent(agentId: string): Promise<void> {
    if (!this.useMessageGateway) return;

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const providers = await AgentBotProviderModel.findByAgentId(serverDB, agentId, gateKeeper);
    const client = getMessageGatewayClient();

    await Promise.all(
      providers.map(async (provider) => {
        if (!provider.enabled) return;

        const definition = platformRegistry.getPlatform(provider.platform);
        const connectionMode = resolveConnectionMode(definition, provider.settings);
        if (connectionMode === 'webhook') return;

        try {
          const { state } = await client.getStatus(provider.id);
          await updateBotRuntimeStatus({
            applicationId: provider.applicationId,
            errorCode: state.errorCode,
            errorMessage: state.error,
            platform: provider.platform,
            status: mapGatewayStatusToRuntimeStatus(state.status),
          });
        } catch (err) {
          log(
            'Bulk refresh: gateway status failed %s:%s: %O',
            provider.platform,
            provider.applicationId,
            err,
          );
        }
      }),
    );
  }

  /**
   * Pull the live connection status from the external message-gateway and
   * persist it to the local Redis snapshot. When the gateway is disabled or
   * the provider runs in webhook mode, returns the cached snapshot as-is.
   */
  async refreshBotRuntimeStatus(
    platform: string,
    applicationId: string,
  ): Promise<BotRuntimeStatusSnapshot> {
    const cached = await getBotRuntimeStatus(platform, applicationId);

    if (!this.useMessageGateway) return cached;

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
      serverDB,
      platform,
      applicationId,
      gateKeeper,
    );

    if (!provider) return cached;

    const definition = platformRegistry.getPlatform(platform);
    const connectionMode = resolveConnectionMode(definition, provider.settings);

    // Webhook-mode bots have no persistent gateway connection to query — the
    // gateway only holds the webhook URL registration, so the local snapshot
    // is already the source of truth.
    if (connectionMode === 'webhook') return cached;

    const client = getMessageGatewayClient();
    try {
      const { state } = await client.getStatus(provider.id);
      return await updateBotRuntimeStatus({
        applicationId,
        errorCode: state.errorCode,
        errorMessage: state.error,
        platform,
        status: mapGatewayStatusToRuntimeStatus(state.status),
      });
    } catch (err) {
      log('Refresh runtime status via gateway failed %s:%s: %O', platform, applicationId, err);
      return cached;
    }
  }

  async stopClient(platform: string, applicationId: string, userId?: string): Promise<void> {
    if (this.useMessageGateway) {
      return this.stopClientViaGateway(platform, applicationId);
    }

    // ─── Legacy: in-process connection management ───
    if (isVercel) {
      // Without a userId we cannot resolve per-provider settings; fall back to the
      // platform default to decide if a queue cleanup is even worth attempting.
      // queue.remove is a no-op for absent keys, so a stale check is harmless.
      let connectionMode: ConnectionMode;
      const definition = platformRegistry.getPlatform(platform);
      if (userId) {
        const serverDB = await getServerDB();
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
        const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
          serverDB,
          platform,
          applicationId,
          gateKeeper,
        );
        connectionMode = resolveConnectionMode(definition, provider?.settings);
      } else {
        connectionMode = resolveConnectionMode(definition, undefined);
      }

      if (connectionMode !== 'webhook') {
        const queue = new BotConnectQueue();
        await queue.remove(platform, applicationId);
      }
    }

    const manager = getGatewayManager();
    if (manager?.isRunning) {
      await manager.stopClient(platform, applicationId);
      log('Stopped client %s:%s', platform, applicationId);
    }

    await updateBotRuntimeStatus({
      applicationId,
      platform,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

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
  async ensureUserMessengerConnected(params: {
    installationKey: string;
    platform: MessengerPlatform;
    userId: string;
  }): Promise<string | null> {
    if (!this.useMessageGateway) return null;

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
      const client = getMessageGatewayClient();
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
  async disconnectUserMessenger(params: {
    installationKey: string;
    platform: MessengerPlatform;
    userId: string;
  }): Promise<void> {
    const { installationKey, platform, userId } = params;
    const connectionMode = messengerPlatformRegistry.getPlatform(platform)?.connectionMode;
    if (connectionMode === 'websocket') return;

    const connectionId = messengerConnectionIdForUser({ connectionMode, installationKey, userId });
    userMessengerConnections.delete(connectionId);

    const client = getMessageGatewayClient();
    if (!client.isConfigured) return;

    try {
      await client.disconnect(connectionId);
      log('disconnectUserMessenger: disconnected %s', connectionId);
    } catch (error) {
      log('disconnectUserMessenger: failed for %s: %O', connectionId, error);
    }
  }

  // ─── External Message Gateway ───

  private async startClientViaGateway(
    platform: string,
    applicationId: string,
    userId: string,
  ): Promise<'started'> {
    const client = getMessageGatewayClient();

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
      serverDB,
      platform,
      applicationId,
      gateKeeper,
    );

    if (!provider) {
      log('No enabled provider found for %s:%s', platform, applicationId);
      throw new Error(`No enabled provider found for ${platform}:${applicationId}`);
    }

    await assertBotFeatureAccess({
      action: 'manage',
      applicationId,
      platform,
      userId: provider.userId,
      workspaceId: provider.workspaceId ?? undefined,
    });

    const definition = platformRegistry.getPlatform(platform);
    const connectionMode = resolveConnectionMode(definition, provider.settings);

    // Webhook-mode platforms don't need persistent gateway connections.
    // Run the platform client locally via GatewayManager so each platform can
    // perform its own initialization (e.g. Telegram calls setWebhook).
    if (connectionMode === 'webhook') {
      const manager = createGatewayManager({ definitions: platformRegistry.listPlatforms() });
      await manager.startClient(platform, applicationId);
      log('Started webhook-mode client locally %s:%s', platform, applicationId);
      return 'started';
    }

    const webhookPath = `/api/agent/webhooks/${platform}/${applicationId}`;

    await client.connect({
      applicationId: provider.applicationId,
      capabilities: resolveBotGatewayCapabilities(provider.settings),
      connectionId: provider.id,
      connectionMode,
      credentials: provider.credentials,
      platform,
      userId,
      webhookPath,
    });

    await updateBotRuntimeStatus({
      applicationId,
      platform,
      status: BOT_RUNTIME_STATUSES.connected,
    });

    log('Started client via message-gateway %s:%s', platform, applicationId);
    return 'started';
  }

  private async stopClientViaGateway(platform: string, applicationId: string): Promise<void> {
    // Stop locally-managed webhook client if it exists (e.g. Telegram deleteWebhook)
    const manager = getGatewayManager();
    if (manager) {
      await manager.stopClient(platform, applicationId);
    }

    const client = getMessageGatewayClient();

    const serverDB = await getServerDB();
    const provider = await AgentBotProviderModel.findByPlatformAndAppId(
      serverDB,
      platform,
      applicationId,
    );

    if (provider) {
      try {
        await client.disconnect(provider.id);
      } catch (err) {
        log('Disconnect via message-gateway failed: %O', err);
      }
    }

    await updateBotRuntimeStatus({
      applicationId,
      platform,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });

    log('Stopped client via message-gateway %s:%s', platform, applicationId);
  }
}
