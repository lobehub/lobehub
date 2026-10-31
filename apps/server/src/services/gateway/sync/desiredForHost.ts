/**
 * Restart recovery, pull side: the connect payloads one host should hold.
 */
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  type DecryptedMessengerAccountLink,
  MessengerAccountLinkModel,
} from '@/database/models/messengerAccountLink';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { messengerConnectionIdForUser } from '@/server/services/messenger/installations';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';

import {
  buildBotProviderConnectConfig,
  buildMessengerPollingConnectConfig,
} from '../gatewayMapping';
import {
  getConfiguredMessageGatewayHosts,
  getMessageGatewayClientForHost,
  type MessageGatewayConnectionConfig,
  type MessageGatewayHost,
  resolveMessageGatewayHost,
} from '../MessageGatewayClient';
import {
  buildDesiredConnections,
  fetchActualConnections,
  hostDesiredSlice,
  hostRefusesPlatform,
} from './state';

const log = debug('lobe-server:service:gateway');

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
export async function listDesiredConnectionsForHost(host: MessageGatewayHost): Promise<{
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
    const snapshot = await fetchActualConnections(getMessageGatewayClientForHost(other));

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
  const { desired, desiredComplete } = await buildDesiredConnections(serverDB, gateKeeper, [host]);
  let complete = desiredComplete;

  for (const entry of hostDesiredSlice(desired, host).values()) {
    if (hostRefusesPlatform(declaredPlatforms, host, entry.platform)) {
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
    if (hostRefusesPlatform(declaredPlatforms, host, platform)) {
      log('Gateway pull[%s]: host does not serve %s, withholding its credentials', host, platform);
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
        log('Gateway pull[%s]: %s not proven released elsewhere, withholding', host, connectionId);
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
