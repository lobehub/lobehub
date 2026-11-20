/**
 * Reconcile of per-user polling messenger connections across gateway hosts.
 */
import debug from 'debug';
import pMap from 'p-map';

import type { getServerDB } from '@/database/core/db-adaptor';
import {
  type DecryptedMessengerAccountLink,
  MessengerAccountLinkModel,
} from '@/database/models/messengerAccountLink';
import type { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { messengerConnectionIdForUser } from '@/server/services/messenger/installations';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';

import { buildMessengerPollingConnectConfig } from '../gatewayMapping';
import {
  getMessageGatewayClientForHost,
  type MessageGatewayHost,
  resolveMessageGatewayHost,
} from '../MessageGatewayClient';
import { GATEWAY_SYNC_CONCURRENCY, GATEWAY_SYNC_STALE_DISCONNECT_LIMIT } from './constants';
import { hostRefusesPlatform } from './state';
import type { ActualConnectionsSnapshot } from './types';

const log = debug('lobe-server:service:gateway');

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
export async function syncMessengerPollingConnections(
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
    if (hostRefusesPlatform(declaredPlatforms, host, platform)) {
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
