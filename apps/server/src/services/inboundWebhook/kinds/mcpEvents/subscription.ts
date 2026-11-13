import type { InboundWebhookError, McpEventsWebhookState } from '@lobechat/types';
import { INBOUND_WEBHOOK_ERRORS } from '@lobechat/types';

import { ConnectorModel } from '@/database/models/connector';
import { appEnv } from '@/envs/app';
import { getMcpEventErrorName } from '@/libs/mcp/events/errors';
import type { McpSubscribeEventParams, McpSubscribeEventResult } from '@/libs/mcp/events/schema';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { buildConnectorMcpParams } from '@/server/services/connector/sync';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import { mcpService } from '@/server/services/mcp';

import type { InboundWebhookContext } from '../types';
import { isMcpAuthError } from './errors';

export const maintenanceBackoff = (failures: number) =>
  Math.min(6 * 3_600_000, 60_000 * 2 ** Math.min(failures, 9));
export const callbackUrl = (id: string) =>
  new URL(`/api/webhooks/inbound/${id}`, appEnv.APP_URL).toString();

export async function connectorForWebhook(ctx: InboundWebhookContext) {
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

export async function applySubscriptionResult(
  ctx: InboundWebhookContext,
  result: McpSubscribeEventResult,
) {
  const state: Partial<McpEventsWebhookState> = {
    refreshBefore: result.refreshBefore,
    remoteSubscriptionId: result.id,
  };
  // Compare-and-swap in SQL: an in-flight receipt's newer watermark always wins.
  if (result.cursor !== undefined)
    await ctx.model.mergeStateIf(
      ctx.row.id,
      { cursor: result.cursor },
      { cursor: ctx.row.state.cursor },
    );
  if (result.deliveryStatus !== undefined) state.deliveryStatus = result.deliveryStatus;
  if (result.truncated) state.truncated = true;
  await ctx.model.mergeState(ctx.row.id, state);
  const reported = result.deliveryStatus?.lastError;
  const lastError: InboundWebhookError | null =
    result.deliveryStatus?.active === false
      ? 'delivery_suspended'
      : reported
        ? (INBOUND_WEBHOOK_ERRORS.find((value) => value === reported) ?? 'unknown')
        : null;
  const now = Date.now();
  await ctx.model.update(ctx.row.id, {
    lastError,
    maintenanceFailures: 0,
    nextMaintenanceAt:
      result.refreshBefore === null
        ? null
        : new Date(now + Math.max(1000, (Date.parse(result.refreshBefore) - now) / 2)),
    status: lastError ? 'error' : 'active',
  });
}

export async function refreshSubscription(ctx: InboundWebhookContext): Promise<void> {
  const { connector, connectorModel } = await connectorForWebhook(ctx);
  if (!connector.isEnabled) {
    // Preserve the remote subscription while disabled; finite subscriptions resume via the sweep.
    await ctx.model.update(ctx.row.id, {
      nextMaintenanceAt: ctx.row.state.refreshBefore ? new Date(Date.now() + 300_000) : null,
    });
    return;
  }
  const fresh = await ensureFreshConnectorToken(connector, connectorModel);
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
  await applySubscriptionResult(ctx, result);
}

/** Manual checks return a row even when the upstream is broken; sweep uses exactly this operation. */
export async function maintainMcpSubscription(ctx: InboundWebhookContext): Promise<void> {
  try {
    await refreshSubscription(ctx);
  } catch (error) {
    console.error(
      '[inboundWebhook:maintain] Subscription refresh failed',
      ctx.row.id,
      getMcpEventErrorName(error) ?? 'transport',
    );
    const failures = ctx.row.maintenanceFailures + 1;
    await ctx.model.update(ctx.row.id, {
      lastError: isMcpAuthError(error) ? 'auth' : 'server_unreachable',
      maintenanceFailures: failures,
      nextMaintenanceAt: new Date(Date.now() + maintenanceBackoff(failures)),
      status: 'error',
    });
  }
}

export async function teardownMcpSubscription(ctx: InboundWebhookContext): Promise<void> {
  const { connector, connectorModel } = await connectorForWebhook(ctx);
  const fresh = await ensureFreshConnectorToken(connector, connectorModel);
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
