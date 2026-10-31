/**
 * Reconcile phase 1: disconnect paid-gated and stale connections.
 */
import debug from 'debug';
import pMap from 'p-map';

import type { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { isMessengerConnectionId } from '@/server/services/messenger/installations';

import { platformRegistry, resolveConnectionMode } from '../../bot/platforms';
import {
  type getMessageGatewayClient,
  getMessageGatewayClientForHost,
  type MessageGatewayHost,
  resolveMessageGatewayHost,
} from '../MessageGatewayClient';
import { BOT_RUNTIME_STATUSES, updateBotRuntimeStatus } from '../runtimeStatus';
import { GATEWAY_SYNC_CONCURRENCY, GATEWAY_SYNC_STALE_DISCONNECT_LIMIT } from './constants';
import { hostDesiredSlice, hostGatedSlice, hostRefusesPlatform } from './state';
import type { ActualConnectionsSnapshot, DesiredGatewayConnection, HostDrainCounts } from './types';

const log = debug('lobe-server:service:gateway');

/**
 * Phase 1 for one host: remove what should no longer be there (paid-gated
 * connections, then stale ones). Runs for every host before any host's
 * connect pass, so a connection is always gone from its old owner before it
 * is built on its new one.
 */
export async function drainHostConnections(params: {
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
  const desired = hostDesiredSlice(params.desired, host);
  const gated = hostGatedSlice(params.gated, host);

  const gatedDisconnected = await disconnectGatedConnections(client, actual, gated);

  // A partial desired set would make healthy connections look stale, so only
  // run the disconnect pass when every platform loaded successfully. A
  // partial ACTUAL set is fine — the pass only disconnects ids it can see.
  let stale = 0;
  if (actual && desiredComplete) {
    stale = await disconnectStaleConnections(
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
 * With a complete registry snapshot, disconnect paid-gated providers only
 * when the connection still exists. When the snapshot is partial or
 * unavailable, preserve access enforcement by falling back to disconnecting
 * every gated id; that bounded set is independent of the desired-connection
 * status fan-out this reconciliation avoids.
 */
export async function disconnectGatedConnections(
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
 * actual − desired → disconnect: connections the gateway still holds whose
 * provider was deleted, disabled, or no longer wants a persistent
 * connection. Messenger-owned connections (per-user typing DOs, SystemBot
 * singletons) carry the `messenger:` prefix and are managed elsewhere —
 * never touch them here.
 */
export async function disconnectStaleConnections(
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
          if (hostRefusesPlatform(declaredPlatforms, owner, row.platform)) {
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
