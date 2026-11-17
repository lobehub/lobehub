import { RequestTrigger } from '@lobechat/types';

import { ConnectorModel } from '@/database/models/connector';
import { TopicModel } from '@/database/models/topic';
import { getMcpEventErrorName } from '@/libs/mcp/events/errors';
import { buildConnectorMcpParams } from '@/server/services/connector/sync';
import { mcpService } from '@/server/services/mcp';

import { isWebhookEnabled } from '../../featureGate';
import { verifyInboundWebhook } from '../../verification';
import type { InboundWebhookKindHandler } from '../types';
import { handleMcpEventDelivery, isVerificationEnvelope } from './delivery';
import {
  connectorAsSubscriber,
  maintainMcpSubscription,
  refreshSubscription,
  teardownMcpSubscription,
} from './subscription';
import { buildMcpEventPrompt } from './wakePrompt';

/** MCP Events (SEP-3415): a connector's server delivers events of one subscription. */
export const mcpEventsKind: InboundWebhookKindHandler<'mcp_events'> = {
  canCheck: true,
  expiresAt: (row) => row.state.refreshBefore ?? null,
  isEnabled: isWebhookEnabled,
  maintain: maintainMcpSubscription,
  async onPersisted({ model, row }, event) {
    if (event.cursor !== undefined)
      await model.mergeStateIf(row.id, { cursor: event.cursor }, { cursor: row.state.cursor });
    if (event.control === 'gap') await model.mergeState(row.id, { truncated: true });
  },
  async parseDelivery(ctx, request) {
    const { row } = ctx;
    let body: unknown;
    try {
      body = JSON.parse(request.body);
    } catch {
      return { response: { error: 'Invalid JSON' }, status: 400 };
    }
    const verification = isVerificationEnvelope(body);
    if (!verification && row.status === 'pending')
      return { response: { error: 'Subscription not active yet' }, status: 503 };
    if (!verification && row.status === 'terminated')
      return { response: { error: 'Subscription ended' }, status: 410 };
    const remoteId = request.headers.get('x-mcp-subscription-id');
    if (remoteId && remoteId !== row.state.remoteSubscriptionId)
      await ctx.model.mergeState(row.id, { remoteSubscriptionId: remoteId });
    return handleMcpEventDelivery(ctx, body, request.headers.get('webhook-id')!);
  },
  async planWake(ctx) {
    const { db, row, batch, model } = ctx;
    const scope = row.workspaceId ?? undefined;
    const connector = row.connectorId
      ? await new ConnectorModel(db, row.userId, scope).findPublicById(row.connectorId)
      : null;
    if (!connector?.isEnabled) {
      await ctx.settle('ignored', 'connector_disabled');
      return { outcome: 'ignored' };
    }
    // Only authenticated control metadata can terminate a subscription. Payload fields are never control instructions.
    const termination = batch.find((s) => s.metadata.extra?.control === 'terminated');
    if (termination) {
      const name = getMcpEventErrorName(termination.payload.error);
      let recovered = false;
      if (name === 'NotFound' || name === 'Unsupported') {
        if (!(await ctx.ownsClaim())) return { outcome: 'deferred' };
        try {
          const kindCtx = { db, featureEnabled: true, model, row };
          const { fresh } = await connectorAsSubscriber(kindCtx);
          const available = await mcpService.listEvents(buildConnectorMcpParams(fresh));
          if (
            available.some(
              (event) => event.name === row.config.eventName && event.delivery.includes('webhook'),
            )
          ) {
            if (!(await ctx.ownsClaim())) return { outcome: 'deferred' };
            await refreshSubscription(kindCtx);
            recovered = true;
          }
        } catch {
          console.error('[inboundWebhook:wake] Event rediscovery failed', row.id);
        }
      }
      if (recovered) {
        // Preserve any actual events in the same debounce window for the next run.
        await ctx.settle('ignored', 'subscription_recovered', [termination]);
        return { outcome: 'recovered' };
      }
      const reason = name === 'Forbidden' ? 'access_revoked' : 'event_unavailable';
      termination.error = reason;
      await model.update(row.id, {
        lastError: reason,
        nextMaintenanceAt: null,
        status: 'terminated',
      });
    }
    return {
      run: {
        externalOrigin: {
          kind: row.config.eventName,
          label: connector.name,
          provider: 'mcp-events',
          resourceId: row.id,
        },
        prompt: buildMcpEventPrompt({ connector, row, signals: batch }),
        topicId: row.topicId!,
        userInterventionConfig: await ctx.intervention(db, row.userId),
      },
    };
  },
  signalSource: 'mcp-events',
  source: (row) => ({
    arguments: row.config.arguments,
    ...(row.config.delivery && { delivery: row.config.delivery }),
    eventName: row.config.eventName,
    kind: 'mcp_events',
  }),
  /** The subscription wakes the Topic it was made in, which must still be its agent's. */
  async targetExists({ db, row }) {
    const topic = row.topicId
      ? await new TopicModel(db, row.userId, row.workspaceId ?? undefined).findById(row.topicId)
      : undefined;
    return !!topic && topic.agentId === row.agentId;
  },
  teardown: teardownMcpSubscription,
  trigger: RequestTrigger.McpEvent,
  // An MCP server always signs; a bearer key is the generic form and proves nothing here.
  verify: ({ request, row, secret }) =>
    verifyInboundWebhook({
      body: request.body,
      headers: request.headers,
      secret,
      verification: row.verification,
    }),
};
