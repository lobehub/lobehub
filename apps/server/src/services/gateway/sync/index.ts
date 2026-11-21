/**
 * Periodic reconcile of the external message gateway(s) against the database.
 */
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { gatewayEnv } from '@/envs/gateway';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';

import { platformRegistry } from '../../bot/platforms';
import {
  getConfiguredMessageGatewayHosts,
  getMessageGatewayClientForHost,
  type MessageGatewayHost,
  resolveMessageGatewayHost,
} from '../MessageGatewayClient';
import { connectHostConnections } from './connect';
import { drainHostConnections } from './drain';
import { syncMessengerPollingConnections } from './messengerPolling';
import { buildDesiredConnections, fetchActualConnections } from './state';
import type { ActualConnectionsSnapshot, HostDrainCounts } from './types';

const log = debug('lobe-server:service:gateway');

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
export async function syncGatewayConnections(): Promise<void> {
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

  const { desired, desiredComplete, gated } = await buildDesiredConnections(
    serverDB,
    gateKeeper,
    hosts,
  );

  const snapshots = new Map<MessageGatewayHost, ActualConnectionsSnapshot | null>();
  for (const host of hosts) {
    snapshots.set(host, await fetchActualConnections(getMessageGatewayClientForHost(host)));
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
      await drainHostConnections({
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
    await connectHostConnections({
      counts: drainCounts.get(host) ?? { gatedDisconnected: 0, gatedSize: 0, stale: 0 },
      currentlyElsewhere,
      declaredPlatforms,
      desired,
      drainedThisRound,
      host,
      snapshot: snapshots.get(host) ?? null,
    });
  }

  await syncMessengerPollingConnections(
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
