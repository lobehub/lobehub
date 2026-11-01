/**
 * Desired and actual connection state for the reconcile: what the database
 * says should exist, what each gateway host holds, and per-host slices.
 */
import debug from 'debug';

import {
  getBotFeatureBlockedMessage,
  isBotFeatureAccessAllowed,
} from '@/business/server/bot/featureAccess';
import type { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { platformRegistry, resolveConnectionMode } from '../../bot/platforms';
import {
  type getMessageGatewayClient,
  type MessageGatewayHost,
  resolveMessageGatewayHost,
} from '../MessageGatewayClient';
import { BOT_RUNTIME_STATUSES, updateBotRuntimeStatus } from '../runtimeStatus';
import type { ActualConnectionsSnapshot, DesiredGatewayConnection } from './types';

const log = debug('lobe-server:service:gateway');

/** Slice of the desired set whose platforms route to `host`. */
export function hostDesiredSlice(
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
export function hostRefusesPlatform(
  declaredPlatforms: Map<MessageGatewayHost, Set<string> | null>,
  host: MessageGatewayHost,
  platform: string,
): boolean {
  const declared = declaredPlatforms.get(host);
  return !!declared && !declared.has(platform);
}

/** Slice of the gated set whose platforms route to `host`. */
export function hostGatedSlice(gated: Map<string, string>, host: MessageGatewayHost): Set<string> {
  return new Set(
    [...gated]
      .filter(([, platform]) => resolveMessageGatewayHost(platform) === host)
      .map(([id]) => id),
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
export async function buildDesiredConnections(
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

      let gatedOnPlatform = 0;
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
          gatedOnPlatform++;
          await updateBotRuntimeStatus({
            applicationId: provider.applicationId,
            errorMessage: getBotFeatureBlockedMessage(
              platform,
              provider.workspaceId ? 'workspace' : 'personal',
            ),
            platform,
            status: BOT_RUNTIME_STATUSES.failed,
          });
          continue;
        }

        desired.set(provider.id, { connectionMode, platform, provider });
      }
      // One line per platform, not per provider: a shared dev database holds
      // hundreds of gated bots, and a line each drowned every other log in
      // the sync. The per-id set still reaches the gated-disconnect step.
      if (gatedOnPlatform > 0)
        log(
          'Gateway sync: %d paid-gated %s provider(s) excluded from desired set',
          gatedOnPlatform,
          platform,
        );
    } catch (err) {
      desiredComplete = false;
      log('Gateway sync: error loading providers for platform %s: %O', platform, err);
    }
  }

  return { desired, desiredComplete, gated };
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
export async function fetchActualConnections(
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
