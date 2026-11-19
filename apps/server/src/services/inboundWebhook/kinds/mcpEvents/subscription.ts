import type { InboundWebhookError, McpEventsWebhookState } from '@lobechat/types';
import { INBOUND_WEBHOOK_ERRORS } from '@lobechat/types';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorStatus } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { getMcpEventErrorName } from '@/libs/mcp/events/errors';
import type { McpSubscribeEventParams, McpSubscribeEventResult } from '@/libs/mcp/events/schema';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  ConnectorAccountGoneError,
  resolveConnectorAccount,
} from '@/server/services/connector/links';
import { buildConnectorMcpParams } from '@/server/services/connector/sync';
import { isWebhookEnabled } from '@/server/services/inboundWebhook/featureGate';
import { mcpService } from '@/server/services/mcp';

import { maintenanceBackoff } from '../../maintenance';
import type { InboundWebhookContext } from '../types';
import { isMcpAuthError } from './errors';

export { maintenanceBackoff } from '../../maintenance';

export const callbackUrl = (id: string) =>
  new URL(`/api/webhooks/inbound/${id}`, appEnv.APP_URL).toString();

export async function connectorForWebhook(ctx: InboundWebhookContext<'mcp_events'>) {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const connectorModel = new ConnectorModel(
    ctx.db,
    ctx.row.userId,
    ctx.row.workspaceId ?? undefined,
    gateKeeper,
  );
  const connector = ctx.row.connectorId ? await connectorModel.findById(ctx.row.connectorId) : null;
  if (!connector) throw new Error('Connector not found');
  return { connector, connectorModel };
}

/** The connector as the account the subscription was made with; the server knows it by that. */
export async function connectorAsSubscriber(ctx: InboundWebhookContext<'mcp_events'>) {
  const { connector, connectorModel } = await connectorForWebhook(ctx);
  const { connector: fresh } = await resolveConnectorAccount(
    connector,
    { connectorModel },
    ctx.row.config.linkId,
  );
  return { connector, fresh };
}

/** Old draft servers reject null TTL. Retry once without TTL, preserving all other identity fields. */
export async function subscribeRemote(
  params: Parameters<typeof mcpService.subscribeEvent>[0],
  input: McpSubscribeEventParams,
) {
  try {
    return await mcpService.subscribeEvent(params, input);
  } catch (error) {
    if (input.ttlMs !== null || getMcpEventErrorName(error) !== 'InvalidParams') throw error;
    const { ttlMs: _ttl, ...fallback } = input;
    return mcpService.subscribeEvent(params, fallback);
  }
}

/** Store a subscribe result; false when the row had moved on (ended, deleted) and kept nothing. */
export async function applySubscriptionResult(
  ctx: InboundWebhookContext<'mcp_events'>,
  result: McpSubscribeEventResult,
): Promise<boolean> {
  const state: Partial<McpEventsWebhookState> = {
    refreshBefore: result.refreshBefore,
    remoteSubscriptionId: result.id,
  };
  if (result.deliveryStatus !== undefined) state.deliveryStatus = result.deliveryStatus;
  if (result.truncated) state.truncated = true;
  const reported = result.deliveryStatus?.lastError;
  const upstreamError: InboundWebhookError | null =
    result.deliveryStatus?.active === false
      ? 'delivery_suspended'
      : reported
        ? (INBOUND_WEBHOOK_ERRORS.find((value) => value === reported) ?? 'unknown')
        : null;
  // A healthy server says nothing about the Channel results go to: a post the Channel refused
  // stays reported until a post (or a check of the Channel) succeeds.
  const lastError =
    upstreamError ?? (ctx.row.lastError === 'channel_unavailable' ? 'channel_unavailable' : null);
  const now = Date.now();
  const updated = await ctx.model.updateIfStatus(
    ctx.row.id,
    {
      lastError,
      maintenanceFailures: 0,
      nextMaintenanceAt:
        result.refreshBefore === null
          ? null
          : new Date(now + Math.max(1000, (Date.parse(result.refreshBefore) - now) / 2)),
      status: upstreamError ? 'error' : 'active',
    },
    ctx.row.status === 'terminated' ? ['terminated'] : ['pending', 'active', 'error'],
    state,
  );
  // Only an explicitly checked ended subscription can resume. A late result from an active
  // subscription cannot revive a concurrent termination or deletion.
  if (updated && result.cursor !== undefined)
    await ctx.model.mergeStateIf(
      ctx.row.id,
      { cursor: result.cursor },
      { cursor: ctx.row.state.cursor },
    );
  return !!updated;
}

export async function refreshSubscription(ctx: InboundWebhookContext<'mcp_events'>): Promise<void> {
  if (!(ctx.featureEnabled ?? (await isWebhookEnabled(ctx.row.userId)))) return;
  const { connector, connectorModel } = await connectorForWebhook(ctx);
  if (!connector.isEnabled) {
    // Preserve the remote subscription while disabled; finite subscriptions resume via the sweep.
    await ctx.model.updateIfStatus(
      ctx.row.id,
      { nextMaintenanceAt: ctx.row.state.refreshBefore ? new Date(Date.now() + 300_000) : null },
      ['pending', 'active', 'error'],
    );
    return;
  }
  const { connector: fresh } = await resolveConnectorAccount(
    connector,
    { connectorModel },
    ctx.row.config.linkId,
  );
  const secret = await ctx.model.getSecret(ctx.row.id);
  if (!secret) throw new Error('Missing webhook signing secret');
  const result = await subscribeRemote(buildConnectorMcpParams(fresh), {
    arguments: ctx.row.config.arguments,
    cursor: ctx.row.state.cursor ?? null,
    delivery: { mode: 'webhook', secret, url: callbackUrl(ctx.row.id) },
    maxAgeMs: 3_600_000,
    name: ctx.row.config.eventName,
    ttlMs: null,
  });
  if (await applySubscriptionResult(ctx, result)) return;
  // The row was deleted while this renewal was in flight. The server may have handled our
  // unsubscribe first and this subscribe after it, re-creating a subscription nothing tracks any
  // more, so take it down again as the same account.
  const current = await ctx.model.findById(ctx.row.id);
  if (!current || current.status === 'deleting') {
    try {
      await teardownMcpSubscription(ctx);
    } catch {
      console.error(
        '[inboundWebhook:maintain] Undoing a renewal after deletion failed',
        ctx.row.id,
      );
    }
  }
}

/** Manual checks return a row even when the upstream is broken; sweep uses exactly this operation. */
export async function maintainMcpSubscription(
  ctx: InboundWebhookContext<'mcp_events'>,
): Promise<void> {
  try {
    await refreshSubscription(ctx);
  } catch (error) {
    console.error(
      '[inboundWebhook:maintain] Subscription refresh failed',
      ctx.row.id,
      getMcpEventErrorName(error) ?? 'transport',
    );
    // The account it was made with is gone: only reconnecting it can bring the subscription back.
    const authFailure = isMcpAuthError(error) || error instanceof ConnectorAccountGoneError;
    if (authFailure && ctx.row.connectorId) {
      const connectorModel = new ConnectorModel(
        ctx.db,
        ctx.row.userId,
        ctx.row.workspaceId ?? undefined,
      );
      await connectorModel.updateStatus(ctx.row.connectorId, ConnectorStatus.error);
    }
    // The server ended this subscription, and only an explicit check reaches here for it. A
    // failed check leaves it ended: relabelling it "reconnect needed" made the same revocation
    // end in two different states depending on whether the check or the termination notice came
    // first, and scheduling retries would resubscribe something the server told us to stop.
    const failures = ctx.row.maintenanceFailures + 1;
    await ctx.model.updateIfStatus(
      ctx.row.id,
      {
        lastError: authFailure ? 'auth' : 'server_unreachable',
        maintenanceFailures: failures,
        nextMaintenanceAt: new Date(Date.now() + maintenanceBackoff(failures)),
        status: 'error',
      },
      ['pending', 'active', 'error'],
    );
  }
}

export async function teardownMcpSubscription(
  ctx: InboundWebhookContext<'mcp_events'>,
): Promise<void> {
  let fresh;
  try {
    ({ fresh } = await connectorAsSubscriber(ctx));
  } catch (error) {
    // Nothing can sign in as a removed account, so there is no one left to unsubscribe as; the
    // server drops the subscription when that account's grant goes.
    if (error instanceof ConnectorAccountGoneError) return;
    throw error;
  }
  try {
    await mcpService.unsubscribeEvent(buildConnectorMcpParams(fresh), {
      arguments: ctx.row.config.arguments,
      delivery: { mode: 'webhook', url: callbackUrl(ctx.row.id) },
      name: ctx.row.config.eventName,
    });
  } catch (error) {
    if (getMcpEventErrorName(error) !== 'NotFound') throw error;
  }
}
