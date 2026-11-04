/**
 * Reconcile phase 2: connect what is desired but missing on a host.
 */
import debug from 'debug';
import pMap from 'p-map';

import { buildBotProviderConnectConfig, mapGatewayStatusToRuntimeStatus } from '../gatewayMapping';
import { getMessageGatewayClientForHost, type MessageGatewayHost } from '../MessageGatewayClient';
import { updateBotRuntimeStatus } from '../runtimeStatus';
import { GATEWAY_SYNC_CONCURRENCY } from './constants';
import { hostDesiredSlice, hostRefusesPlatform } from './state';
import type { ActualConnectionsSnapshot, DesiredGatewayConnection, HostDrainCounts } from './types';

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

const log = debug('lobe-server:service:gateway');

/**
 * Phase 2 for one host: `desired − actual → connect`. Every host has already
 * been drained by the time this runs.
 */
export async function connectHostConnections(params: {
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
  const desired = hostDesiredSlice(params.desired, host);

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
    .filter((id) => (actual?.connections.has(id) ?? false) && actual?.connections.get(id) === null);
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
        if (hostRefusesPlatform(declaredPlatforms, host, platform)) {
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
            log('Gateway sync: %s registered-only, not sampled this round, deferring', provider.id);
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
