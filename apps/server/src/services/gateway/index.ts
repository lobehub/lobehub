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
import {
  type DecryptedMessengerAccountLink,
  MessengerAccountLinkModel,
} from '@/database/models/messengerAccountLink';
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
  getConfiguredMessageGatewayHosts,
  getMessageGatewayClient,
  getMessageGatewayClientForHost,
  isAnyMessageGatewayEnabled,
  type MessageGatewayCapabilities,
  type MessageGatewayConnectionConfig,
  type MessageGatewayConnectionStatus,
  type MessageGatewayHost,
  resolveMessageGatewayHost,
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

/** What one host's drain phase removed, carried into its connect-phase log line. */
interface HostDrainCounts {
  gatedDisconnected: number;
  gatedSize: number;
  stale: number;
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

/**
 * The connect payload for one bot-channel provider.
 *
 * Extracted because two callers build it now: the periodic reconcile, which
 * pushes it to the gateway, and the gateway's own boot-time pull, which
 * receives it and connects itself. A second builder would drift, and the
 * connection the gateway ends up holding would then depend on which side
 * established it.
 *
 * Payload only, deliberately no side effects. The push path also writes a
 * runtime status from the connect result, but that belongs to whoever
 * actually connected: on the pull path the gateway does, so its state
 * callback is what reports the real status back. Guessing a status here would
 * record a connection as live that nothing has established yet.
 */
const buildBotProviderConnectConfig = ({
  connectionMode,
  platform,
  provider,
}: DesiredGatewayConnection): MessageGatewayConnectionConfig => ({
  applicationId: provider.applicationId,
  capabilities: resolveBotGatewayCapabilities(provider.settings),
  connectionId: provider.id,
  connectionMode,
  credentials: provider.credentials,
  platform,
  userId: provider.userId,
  webhookPath: `/api/agent/webhooks/${platform}/${provider.applicationId}`,
});

/** The connect payload for one messenger polling link. Same rationale as above. */
const buildMessengerPollingConnectConfig = ({
  connectionId,
  link,
  platform,
}: {
  connectionId: string;
  link: DecryptedMessengerAccountLink;
  platform: string;
}): MessageGatewayConnectionConfig => {
  const credentials = link.credentials as {
    baseUrl?: string;
    botId?: string;
    botToken?: string;
  };

  return {
    applicationId: link.applicationId!,
    // Messenger-owned connections never consume passive channel monitoring —
    // the shared bot only reacts to DMs and explicit mentions.
    capabilities: { messageMonitoring: { enabled: false } },
    connectionId,
    connectionMode: 'polling',
    credentials: {
      baseUrl: credentials.baseUrl,
      botId: credentials.botId,
      botToken: credentials.botToken,
      webhookToken: gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN,
    },
    platform,
    userId: link.userId,
    webhookPath: `/api/agent/messenger/webhooks/${platform}`,
  };
};

const isVercel = !!process.env.VERCEL_ENV;

export class GatewayService {
  /**
   * Whether to use the external message-gateway for connection management.
   * Requires MESSAGE_GATEWAY_ENABLED=1 plus URL/TOKEN to be configured.
   * This allows disabling the gateway (for migration) while keeping
   * the client reachable for cleanup.
   */
  get useMessageGateway(): boolean {
    return isAnyMessageGatewayEnabled();
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
    for (const host of getConfiguredMessageGatewayHosts()) {
      const client = getMessageGatewayClientForHost(host);
      if (!client.isConfigured) continue;
      try {
        const result = await client.disconnectAll();
        if (result.total > 0) {
          log('Cleaned up %d gateway connections on %s host', result.total, host);
        }
      } catch (err) {
        log('Gateway cleanup skipped on %s host (non-critical): %O', host, err);
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
    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    // Each configured host gets its own desired slice and its own actual
    // snapshot, then runs the full diff independently. Cross-host moves fall
    // out of the partition: a platform routed away from a host leaves its ids
    // absent from that host's desired slice → the stale pass disconnects them
    // there while the new host's connect pass builds them up.
    const hosts = getConfiguredMessageGatewayHosts();

    // A platform name nothing recognises is a typo, and its only visible
    // effect is that the migration silently does not happen — the name simply
    // never matches, so everything stays on the default host. Say so once per
    // round instead of leaving someone to wonder why the flip did nothing.
    const routedNames = (gatewayEnv.MESSAGE_GATEWAY_NODE_PLATFORMS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (routedNames.length > 0) {
      const known = new Set([
        ...platformRegistry.listPlatforms().map((definition) => definition.id),
        ...messengerPlatformRegistry.listPlatforms().map((definition) => definition.id),
      ]);
      const unknown = routedNames.filter((name) => !known.has(name));
      if (unknown.length > 0) {
        log(
          'Gateway sync: MESSAGE_GATEWAY_NODE_PLATFORMS names %o, which match no known platform — those entries do nothing',
          unknown,
        );
      }
    }

    // What each host says it can serve. Routing a platform to a host it cannot
    // serve is otherwise an outage, not a no-op: the stale pass drains the
    // connections off their old host, and the connect that should replace them
    // is rejected — so they end up nowhere. One request per host per round.
    const declaredPlatforms = new Map<MessageGatewayHost, Set<string> | null>();
    for (const host of hosts) {
      const capabilities = await getMessageGatewayClientForHost(host).getCapabilities();
      declaredPlatforms.set(host, capabilities ? new Set(capabilities.platforms ?? []) : null);
    }

    const { desired, desiredComplete, gated } = await this.buildDesiredConnections(
      serverDB,
      gateKeeper,
      hosts,
    );

    const snapshots = new Map<MessageGatewayHost, ActualConnectionsSnapshot | null>();
    for (const host of hosts) {
      snapshots.set(host, await this.fetchActualConnections(getMessageGatewayClientForHost(host)));
    }

    // A cross-host move must not tear the source down before the destination
    // can take over. A host whose snapshot is missing or incomplete defers
    // every connect for an id it cannot see (absence doesn't prove absence),
    // so disconnecting there first would take the platform dark until some
    // later round. Only hosts with a complete snapshot are safe destinations.
    const hostsReadyToReceive = new Set(
      hosts.filter((host) => snapshots.get(host)?.complete === true),
    );

    // Ids a snapshot shows on a host that no longer owns them — i.e. mid-move.
    // Draining them is capped per round, so without this the destination's
    // connect pass would happily build up every id the source pass had no
    // budget to remove, and the overflow would run on both hosts at once.
    const currentlyElsewhere = new Set<string>();
    for (const [host, snapshot] of snapshots) {
      if (!snapshot) continue;
      for (const id of snapshot.connections.keys()) {
        const entry = desired.get(id);
        if (entry && resolveMessageGatewayHost(entry.platform) !== host) currentlyElsewhere.add(id);
      }
    }
    // Filled in by each host's stale pass as it actually removes an id, which
    // is what releases that id for connecting on its new owner.
    const drainedThisRound = new Set<string>();

    // Two phases across ALL hosts rather than a full sync per host: every
    // drain completes before any build-up. Interleaving them makes correctness
    // depend on the order `hosts` happens to be in — with `['default','node']`
    // a node→default rollback would run the destination's connect pass first
    // (deferring everything, since nothing is drained yet), then drain the
    // source, and never revisit the destination, leaving every migrated bot
    // down for a whole round. Splitting the phases makes the ordering
    // structural instead of emergent, in both directions.
    const drainCounts = new Map<MessageGatewayHost, HostDrainCounts>();
    for (const host of hosts) {
      drainCounts.set(
        host,
        await this.drainHostConnections({
          declaredPlatforms,
          desired,
          desiredComplete,
          drainedThisRound,
          gated,
          host,
          hostsReadyToReceive,
          serverDB,
          snapshot: snapshots.get(host) ?? null,
        }),
      );
    }

    for (const host of hosts) {
      await this.connectHostConnections({
        counts: drainCounts.get(host) ?? { gatedDisconnected: 0, gatedSize: 0, stale: 0 },
        currentlyElsewhere,
        declaredPlatforms,
        desired,
        drainedThisRound,
        host,
        snapshot: snapshots.get(host) ?? null,
      });
    }

    await this.syncMessengerPollingConnections(
      serverDB,
      gateKeeper,
      snapshots,
      hostsReadyToReceive,
      declaredPlatforms,
    );

    log(
      'Gateway sync complete in %dms across %d host(s): desired=%d gated=%d',
      Date.now() - startedAt,
      hosts.length,
      desired.size,
      gated.size,
    );
  }

  /** Slice of the desired set whose platforms route to `host`. */
  private hostDesiredSlice(
    desired: Map<string, DesiredGatewayConnection>,
    host: MessageGatewayHost,
  ): Map<string, DesiredGatewayConnection> {
    return new Map(
      [...desired].filter(([, entry]) => resolveMessageGatewayHost(entry.platform) === host),
    );
  }

  /**
   * Whether `host` has told us it cannot serve `platform`.
   *
   * Only an explicit declaration counts. A gateway that does not describe
   * itself makes no claim, and absence of information must never be read as a
   * refusal — the Cloudflare gateway has no capabilities endpoint at all, and
   * treating that as "refuses everything" would block the rollback path,
   * where connections move BACK to it.
   */
  private hostRefusesPlatform(
    declaredPlatforms: Map<MessageGatewayHost, Set<string> | null>,
    host: MessageGatewayHost,
    platform: string,
  ): boolean {
    const declared = declaredPlatforms.get(host);
    return !!declared && !declared.has(platform);
  }

  /** Slice of the gated set whose platforms route to `host`. */
  private hostGatedSlice(gated: Map<string, string>, host: MessageGatewayHost): Set<string> {
    return new Set(
      [...gated]
        .filter(([, platform]) => resolveMessageGatewayHost(platform) === host)
        .map(([id]) => id),
    );
  }

  /**
   * The connect payloads one host should currently be holding.
   *
   * This is the read half of restart recovery: a gateway that just came back
   * up holds nothing, asks for this list, and builds it itself. Nothing here
   * calls a gateway, so it wakes no connection and can be retried freely —
   * the one write it does make is the runtime status of a paid-gated
   * provider, which `buildDesiredConnections` records on the way past and
   * which is true no matter who asked.
   *
   * `complete: false` means the desired set could not be computed in full (a
   * platform's rows failed to load, key vault unavailable). The caller should
   * apply what it got and ask again rather than treat a short list as the
   * whole truth. Refusing to answer at all would be worse: it leaves the
   * gateway holding nothing for the length of an unrelated outage.
   *
   * Rows that can never connect — credentials missing or undecryptable — are
   * counted into `excluded` and left out. They must not fail the call: a
   * single unreadable row would otherwise keep a whole gateway empty forever.
   *
   * Connections another host still holds are withheld and counted into
   * `deferred`. Routing alone does not make a connection safe to build: right
   * after a platform is routed here, the previous host is still polling it,
   * and handing it over before that host is drained double-delivers every
   * message until a later reconcile catches up. The periodic reconcile owns
   * the hand-off; this call only refuses to race it.
   */
  async listDesiredConnectionsForHost(host: MessageGatewayHost): Promise<{
    complete: boolean;
    connections: { config: MessageGatewayConnectionConfig; ensure: true }[];
    deferred: number;
    excluded: number;
  }> {
    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    const connections: { config: MessageGatewayConnectionConfig; ensure: true }[] = [];
    let excluded = 0;
    let deferred = 0;

    // What every OTHER host still holds. Read-only, and only two admin
    // requests per host — they reach the gateway's own registry, not the
    // individual connections, so asking wakes nothing.
    //
    // A host whose admin surface is unreachable is treated as holding
    // nothing, deliberately, and matching the reconcile's own rule: a
    // steady-state deployment has no connections on the wrong host at all, so
    // blocking every restart recovery on an unrelated host's outage costs far
    // more availability than the duplicate window it would avoid — and that
    // window only opens if the outage overlaps an actual migration.
    // What this host says it can serve. Routing a platform here does not mean
    // it can run it, and handing over credentials for a connection it will
    // reject is handing them over for nothing. The reconcile already refuses
    // to move such a platform; this refuses to arm it.
    const declared = await getMessageGatewayClientForHost(host).getCapabilities();
    const declaredPlatforms = new Map<MessageGatewayHost, Set<string> | null>([
      [host, declared ? new Set(declared.platforms ?? []) : null],
    ]);

    const elsewhere = new Set<string>();
    let peersProven = true;
    for (const other of getConfiguredMessageGatewayHosts()) {
      if (other === host) continue;
      const snapshot = await this.fetchActualConnections(getMessageGatewayClientForHost(other));

      // Absence is only evidence when the view was complete. A snapshot we
      // could not fetch shows nothing, and a stats-only one omits dormant
      // registrations — in both cases an id missing from it says nothing about
      // whether that host released it, so nothing here can be handed over.
      // Marking the answer incomplete does not substitute: the caller applies
      // what it receives and only then asks again, so a flag arrives after the
      // duplicate it was supposed to prevent.
      if (!snapshot?.complete) {
        peersProven = false;
        log(
          'Gateway pull[%s]: %s host view is %s, cannot prove it released anything',
          host,
          other,
          snapshot ? 'incomplete' : 'unavailable',
        );
      }

      snapshot?.connections.forEach((_status, id) => elsewhere.add(id));
    }

    // Paid-gated providers never enter the desired set, so nothing here can
    // hand back a connection the next reconcile round would tear down again.
    const { desired, desiredComplete } = await this.buildDesiredConnections(serverDB, gateKeeper, [
      host,
    ]);
    let complete = desiredComplete;

    for (const entry of this.hostDesiredSlice(desired, host).values()) {
      if (this.hostRefusesPlatform(declaredPlatforms, host, entry.platform)) {
        excluded++;
        continue;
      }
      if (Object.keys(entry.provider.credentials).length === 0) {
        excluded++;
        continue;
      }
      if (!peersProven || elsewhere.has(entry.provider.id)) {
        deferred++;
        log(
          'Gateway pull[%s]: %s not proven released elsewhere, withholding',
          host,
          entry.provider.id,
        );
        continue;
      }
      connections.push({ config: buildBotProviderConnectConfig(entry), ensure: true });
    }

    for (const definition of messengerPlatformRegistry.listPlatforms()) {
      if (definition.connectionMode !== 'polling') continue;
      const platform = definition.id;
      if (resolveMessageGatewayHost(platform) !== host) continue;
      if (this.hostRefusesPlatform(declaredPlatforms, host, platform)) {
        log(
          'Gateway pull[%s]: host does not serve %s, withholding its credentials',
          host,
          platform,
        );
        continue;
      }

      let links: DecryptedMessengerAccountLink[];
      try {
        links = await MessengerAccountLinkModel.findAllByPlatformWithCredentials(
          serverDB,
          platform,
          gateKeeper,
        );
      } catch (err) {
        // Same rule as the desired set: a platform we could not read makes the
        // answer incomplete, not empty.
        complete = false;
        log('Gateway pull[%s]: messenger link listing failed for %s: %O', host, platform, err);
        continue;
      }

      for (const link of links) {
        const credentials = link.credentials as { botToken?: string };
        const connectionId = messengerConnectionIdForUser({
          connectionMode: 'polling',
          installationKey: `${platform}:${link.tenantId}`,
          userId: link.userId,
        });
        if (!link.applicationId || !credentials.botToken) {
          excluded++;
          continue;
        }
        if (!peersProven || elsewhere.has(connectionId)) {
          deferred++;
          log(
            'Gateway pull[%s]: %s not proven released elsewhere, withholding',
            host,
            connectionId,
          );
          continue;
        }
        connections.push({
          config: buildMessengerPollingConnectConfig({ connectionId, link, platform }),
          ensure: true,
        });
      }
    }

    // Audit surface: this is the one place that hands out a host's whole
    // credential set, and it doubles as the signal that the host restarted.
    // Withheld entries make this a partial answer, so the caller keeps asking
    // instead of settling for the set it got. It will run out of attempts long
    // before a hand-off finishes — that is fine: finishing one is the periodic
    // reconcile's job, not this call's. Restart recovery is an optimisation
    // over that reconcile, so when it cannot be done safely the right move is
    // not to do it.
    if (deferred > 0) complete = false;

    log(
      'Gateway pull[%s]: %d connection(s), excluded=%d, deferred=%d, complete=%s',
      host,
      connections.length,
      excluded,
      deferred,
      complete,
    );

    return { complete, connections, deferred, excluded };
  }

  /**
   * Phase 1 for one host: remove what should no longer be there (paid-gated
   * connections, then stale ones). Runs for every host before any host's
   * connect pass, so a connection is always gone from its old owner before it
   * is built on its new one.
   */
  private async drainHostConnections(params: {
    declaredPlatforms: Map<MessageGatewayHost, Set<string> | null>;
    desired: Map<string, DesiredGatewayConnection>;
    desiredComplete: boolean;
    drainedThisRound: Set<string>;
    gated: Map<string, string>;
    host: MessageGatewayHost;
    hostsReadyToReceive: Set<MessageGatewayHost>;
    serverDB: Awaited<ReturnType<typeof getServerDB>>;
    snapshot: ActualConnectionsSnapshot | null;
  }): Promise<HostDrainCounts> {
    const {
      declaredPlatforms,
      desiredComplete,
      drainedThisRound,
      host,
      hostsReadyToReceive,
      serverDB,
      snapshot: actual,
    } = params;
    const client = getMessageGatewayClientForHost(host);
    const desired = this.hostDesiredSlice(params.desired, host);
    const gated = this.hostGatedSlice(params.gated, host);

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
        host,
        hostsReadyToReceive,
        drainedThisRound,
        declaredPlatforms,
      );
    } else if (actual) {
      log('Gateway sync: desired set incomplete, skipping stale-connection cleanup this round');
    }

    return { gatedDisconnected, gatedSize: gated.size, stale };
  }

  /**
   * Phase 2 for one host: `desired − actual → connect`. Every host has already
   * been drained by the time this runs.
   */
  private async connectHostConnections(params: {
    counts: HostDrainCounts;
    currentlyElsewhere: Set<string>;
    declaredPlatforms: Map<MessageGatewayHost, Set<string> | null>;
    desired: Map<string, DesiredGatewayConnection>;
    drainedThisRound: Set<string>;
    host: MessageGatewayHost;
    snapshot: ActualConnectionsSnapshot | null;
  }): Promise<void> {
    const {
      counts,
      currentlyElsewhere,
      declaredPlatforms,
      drainedThisRound,
      host,
      snapshot: actual,
    } = params;
    const client = getMessageGatewayClientForHost(host);
    const desired = this.hostDesiredSlice(params.desired, host);

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
          // Told us it cannot serve this platform. The connect would be
          // rejected anyway; skipping keeps one clear line in the log instead
          // of an error per connection, and pairs with the stale pass, which
          // leaves these running wherever they already are.
          if (this.hostRefusesPlatform(declaredPlatforms, host, platform)) {
            skipped++;
            return;
          }

          // Credentials missing/undecryptable: the provider is still desired
          // (protected from the stale pass) but a connect attempt can only
          // fail — leave whatever connection state the gateway already holds.
          if (Object.keys(provider.credentials).length === 0) {
            skipped++;
            log('Gateway sync: %s credentials unavailable, skipping connect', provider.id);
            return;
          }

          // Mid-move and STILL not drained, even though every host's drain
          // phase has already run — so it is over this round's disconnect cap
          // or its disconnect failed. Connecting now would leave the provider
          // live on both gateways, double-delivering until a later round
          // catches up.
          if (currentlyElsewhere.has(provider.id) && !drainedThisRound.has(provider.id)) {
            deferred++;
            log(
              'Gateway sync[%s]: %s not yet drained from its previous host, deferring connect',
              host,
              provider.id,
            );
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

          // `ensure` marks this as a reconcile connect: the gateway preserves
          // its park/backoff state when the config is unchanged (a parked
          // connection answers 409 → counted as failed below), instead of
          // letting every sync round reset stuck connections to fast retry.
          const result = await client.connect(
            buildBotProviderConnectConfig({ connectionMode, platform, provider }),
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
      'Gateway sync[%s]: desired=%d actual=%s snapshotComplete=%s connected=%d skipped=%d deferred=%d gated=%d gatedDisconnected=%d stale=%d failed=%d registeredOnlyWakes=%d registeredOnlyDeferred=%d',
      host,
      desired.size,
      actual ? actual.connections.size : 'unavailable',
      actual?.complete ?? false,
      connected,
      skipped,
      deferred,
      counts.gatedSize,
      counts.gatedDisconnected,
      counts.stale,
      failed,
      registeredOnlyWakes,
      registeredOnlyDeferred,
    );
  }

  /**
   * Reconcile per-user polling messenger connections (WeChat today) onto the
   * gateway host that owns their platform.
   *
   * Bot-provider connections are covered by the desired/actual diff above,
   * but messenger-owned ids (`messenger:<platform>:…`) were historically
   * excluded from reconciliation: on the default gateway they are durable
   * Durable Objects, lazily created at link time. Two things break that
   * model:
   *
   *  - the Node gateway keeps connections in process memory, so without a
   *    reconcile every redeploy would silently stop all polling until each
   *    user re-linked;
   *  - moving a platform between hosts needs the old host's connections torn
   *    down and the new host's rebuilt, link by link.
   *
   * Webhook typing shards and websocket singletons stay excluded — they are
   * lazily managed (`ensureUserMessengerConnected`) and harmless to lose.
   */
  private async syncMessengerPollingConnections(
    serverDB: Awaited<ReturnType<typeof getServerDB>>,
    gateKeeper: KeyVaultsGateKeeper,
    snapshots: Map<MessageGatewayHost, ActualConnectionsSnapshot | null>,
    hostsReadyToReceive: Set<MessageGatewayHost>,
    declaredPlatforms: Map<MessageGatewayHost, Set<string> | null>,
  ): Promise<void> {
    for (const definition of messengerPlatformRegistry.listPlatforms()) {
      if (definition.connectionMode !== 'polling') continue;
      const platform = definition.id;
      const host = resolveMessageGatewayHost(platform);
      const client = getMessageGatewayClientForHost(host);
      if (!client.isEnabled) continue;

      // Routed to a host that says it cannot serve this platform. Skipping the
      // whole platform leaves every connection where it already runs — the
      // teardown below would otherwise strip them from their current host for
      // a destination that will reject them.
      if (this.hostRefusesPlatform(declaredPlatforms, host, platform)) {
        log(
          'Gateway sync[%s]: host does not serve %s — leaving its connections where they are',
          host,
          platform,
        );
        continue;
      }

      const prefix = `messenger:${platform}:`;

      // Load the links BEFORE touching any host. A migration that drains the
      // old host and only then discovers it cannot read the account links
      // leaves those users offline until a later round — so the lookup that
      // can fail runs while a failure is still free.
      let links: DecryptedMessengerAccountLink[];
      try {
        links = await MessengerAccountLinkModel.findAllByPlatformWithCredentials(
          serverDB,
          platform,
          gateKeeper,
        );
      } catch (err) {
        log('Gateway sync[%s]: messenger link listing failed for %s: %O', host, platform, err);
        continue;
      }

      // Classify BEFORE draining anything: the teardown below has to know
      // which ids it must not touch, and a link is only safe to move once we
      // know we can rebuild it on the other side.
      const desired = new Map<string, DecryptedMessengerAccountLink>();
      // Linked accounts we cannot connect but must not treat as unlinked.
      const unusable = new Set<string>();
      for (const link of links) {
        const credentials = link.credentials as { botToken?: string };
        const connectionId = messengerConnectionIdForUser({
          connectionMode: 'polling',
          installationKey: `${platform}:${link.tenantId}`,
          userId: link.userId,
        });
        // A link whose credentials fail to decrypt comes back with an empty
        // object, indistinguishable here from one that never had a token.
        // Either way a connect can only fail — but the account IS still
        // linked, so it must stay out of the stale pass: otherwise a
        // key-vault mismatch reads as "everyone unlinked" and tears down
        // every healthy poller in a single round.
        if (!link.applicationId || !credentials.botToken) {
          unusable.add(connectionId);
          continue;
        }
        desired.set(connectionId, link);
      }

      // Ids this round leaves running on a host that no longer owns them —
      // past the per-round cap, failed to disconnect, or not attempted at all.
      // The connect pass must skip these: connecting one while it still polls
      // elsewhere is exactly the double-delivery this pass exists to prevent.
      const stillElsewhere = new Set<string>();

      // Tear down this platform's per-user connections on every other host —
      // a polling platform hosted twice double-delivers every message. Runs
      // before the owning host's connect pass for the same reason
      // (disconnect-then-connect ordering during a host migration).
      for (const [otherHost, otherSnapshot] of snapshots) {
        if (otherHost === host) continue;

        // A host we cannot see cannot be drained, and its admin surface being
        // down does not mean its pollers stopped. Deliberate trade-off: we
        // still connect on the owning host rather than block on it, because a
        // steady-state deployment has no strays here at all, and holding every
        // reconcile hostage to an unrelated host's admin outage costs far more
        // availability than the duplicate-delivery window it would avoid —
        // which only opens if that outage overlaps an actual migration.
        if (!otherSnapshot) {
          log(
            'Gateway sync[%s]: %s host snapshot unavailable — cannot confirm %s is drained there',
            host,
            otherHost,
            platform,
          );
          continue;
        }

        // An unusable link cannot be rebuilt on the owning host, so moving it
        // is a one-way trip to offline. Leave its existing connection alone —
        // wherever it currently runs, it is still serving that user.
        const strayIds = [...otherSnapshot.connections.keys()].filter(
          (id) => id.startsWith(prefix) && !unusable.has(id),
        );
        if (strayIds.length === 0) continue;

        // Same rule as the bot-provider stale pass: never strip the source
        // while the destination cannot take over, or the platform goes dark
        // for the length of the destination's outage.
        if (!hostsReadyToReceive.has(host)) {
          strayIds.forEach((id) => stillElsewhere.add(id));
          log(
            'Gateway sync[%s]: %s host has no usable snapshot — leaving %d %s connection(s) on %s host',
            host,
            host,
            strayIds.length,
            platform,
            otherHost,
          );
          continue;
        }

        const batch = strayIds.slice(0, GATEWAY_SYNC_STALE_DISCONNECT_LIMIT);
        strayIds.slice(GATEWAY_SYNC_STALE_DISCONNECT_LIMIT).forEach((id) => stillElsewhere.add(id));
        if (batch.length < strayIds.length) {
          log(
            'Gateway sync[%s]: capping cross-host %s migration to %d of %d this round',
            host,
            platform,
            batch.length,
            strayIds.length,
          );
        }

        const otherClient = getMessageGatewayClientForHost(otherHost);
        await pMap(
          batch,
          async (id) => {
            try {
              await otherClient.disconnect(id);
              log('Gateway sync[%s]: moved %s off %s host', host, id, otherHost);
            } catch (err) {
              stillElsewhere.add(id);
              log('Gateway sync[%s]: cross-host disconnect failed %s: %O', host, id, err);
            }
          },
          { concurrency: GATEWAY_SYNC_CONCURRENCY },
        );
      }

      const snapshot = snapshots.get(host) ?? null;

      let connected = 0;
      let skipped = 0;
      let failed = 0;

      await pMap(
        [...desired],
        async ([connectionId, link]) => {
          // Without any snapshot we can't tell existing from missing — blind
          // reconnects would churn healthy pollers, so wait for a round with
          // a working admin surface.
          if (!snapshot) {
            skipped++;
            return;
          }
          // Still polling on a host that no longer owns it (past this round's
          // migration cap, or its disconnect failed). Connecting here too
          // would double-deliver every inbound message until the next round
          // finishes the move.
          if (stillElsewhere.has(connectionId)) {
            skipped++;
            log(
              'Gateway sync[%s]: %s still live on another host, deferring connect',
              host,
              connectionId,
            );
            return;
          }
          const exists = snapshot.connections.has(connectionId);
          const status = snapshot.connections.get(connectionId);
          // Live and healthy → nothing to do. Registered-only (null) gets an
          // ensure-connect wake (parked connections answer 409 and keep their
          // park); missing from a complete snapshot gets a real connect.
          if (exists && status !== null && status !== 'disconnected') {
            skipped++;
            return;
          }
          if (!exists && !snapshot.complete) {
            skipped++;
            return;
          }
          try {
            await client.connect(
              buildMessengerPollingConnectConfig({ connectionId, link, platform }),
              { ensure: true },
            );
            connected++;
          } catch (err) {
            failed++;
            log('Gateway sync[%s]: messenger connect failed %s: %O', host, connectionId, err);
          }
        },
        { concurrency: GATEWAY_SYNC_CONCURRENCY },
      );

      // Unlinked accounts whose connection still exists on the owning host.
      // `unusable` ids are linked but unconnectable — they belong to neither
      // set and must survive this pass untouched.
      let stale = 0;
      if (snapshot?.complete) {
        const staleIds = [...snapshot.connections.keys()]
          .filter((id) => id.startsWith(prefix) && !desired.has(id) && !unusable.has(id))
          .slice(0, GATEWAY_SYNC_STALE_DISCONNECT_LIMIT);
        await pMap(
          staleIds,
          async (id) => {
            try {
              await client.disconnect(id);
              stale++;
              log('Gateway sync[%s]: disconnected unlinked messenger connection %s', host, id);
            } catch (err) {
              log('Gateway sync[%s]: messenger stale disconnect failed %s: %O', host, id, err);
            }
          },
          { concurrency: GATEWAY_SYNC_CONCURRENCY },
        );
      }

      log(
        'Gateway sync[%s]: messenger %s links=%d connected=%d skipped=%d stale=%d failed=%d',
        host,
        platform,
        desired.size,
        connected,
        skipped,
        stale,
        failed,
      );
    }
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
    hosts: MessageGatewayHost[],
  ): Promise<{
    desired: Map<string, DesiredGatewayConnection>;
    desiredComplete: boolean;
    /** Paid-gated provider id → platform (platform drives host partitioning). */
    gated: Map<string, string>;
  }> {
    const desired = new Map<string, DesiredGatewayConnection>();
    let desiredComplete = true;
    const gated = new Map<string, string>();

    for (const definition of platformRegistry.listPlatforms()) {
      const platform = definition.id;

      // Only platforms owned by one of `hosts`. Loading the rest would decrypt
      // credentials for connections this call is never going to look at — pure
      // waste for a single-host pull, and a wider blast radius on failure.
      if (!hosts.includes(resolveMessageGatewayHost(platform))) continue;

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
            gated.set(provider.id, platform);
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
    host: MessageGatewayHost,
    hostsReadyToReceive: Set<MessageGatewayHost>,
    drainedThisRound: Set<string>,
    declaredPlatforms: Map<MessageGatewayHost, Set<string> | null>,
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

          // An enabled persistent-mode row that shows up in `actual` but not
          // in `desired` is one of two things, and only one of them is stale.
          const livePersistentRow =
            row?.enabled &&
            resolveConnectionMode(platformRegistry.getPlatform(row.platform), row.settings) !==
              'webhook';

          if (livePersistentRow) {
            const owner = resolveMessageGatewayHost(row.platform);

            // TOCTOU: enabled (and connected) between the desired snapshot and
            // the actual fetch. This row was queried after both, so trust it —
            // leave it for the next round to classify with a fresh desired set.
            if (owner === host) {
              log('Gateway sync: %s enabled during sync, skipping stale disconnect', id);
              return;
            }

            // Routed to another host: this IS the cross-host move the stale
            // pass exists to perform — but only once the destination can
            // actually take over. Disconnecting into a host that will defer
            // every connect would take the connection dark for the whole
            // outage, so hold it here and retry next round.
            if (!hostsReadyToReceive.has(owner)) {
              log(
                'Gateway sync[%s]: %s belongs on %s host, which has no usable snapshot — deferring move',
                host,
                id,
                owner,
              );
              return;
            }

            // Routed somewhere that has told us it cannot serve this platform.
            // Draining here would be worse than doing nothing: the connect
            // meant to replace it gets rejected, so the connection ends up on
            // neither host. Leave it running and let the misrouting be fixed.
            if (this.hostRefusesPlatform(declaredPlatforms, owner, row.platform)) {
              log(
                'Gateway sync[%s]: %s is routed to the %s host, which does not serve %s — refusing to drain',
                host,
                id,
                owner,
                row.platform,
              );
              return;
            }
          }

          await client.disconnect(id);
          disconnected++;
          // Releases the id for its new owner's connect pass this same round.
          drainedThisRound.add(id);

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

    await Promise.all(
      providers.map(async (provider) => {
        if (!provider.enabled) return;

        const definition = platformRegistry.getPlatform(provider.platform);
        const connectionMode = resolveConnectionMode(definition, provider.settings);
        if (connectionMode === 'webhook') return;

        try {
          const client = getMessageGatewayClient(provider.platform);
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

    const client = getMessageGatewayClient(platform);
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

    const client = getMessageGatewayClient(platform);
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
    const client = getMessageGatewayClient(platform);

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

    const client = getMessageGatewayClient(platform);

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
