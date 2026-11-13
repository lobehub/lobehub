import { RequestTrigger } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { and, eq, inArray } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { TopicModel } from '@/database/models/topic';
import { signals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getMcpEventErrorName } from '@/libs/mcp/events/errors';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type { AiAgentService } from '@/server/services/aiAgent';
import { resolveForegroundInterventionConfig } from '@/server/services/aiAgent/foregroundIntervention';
import { redisService } from '@/server/services/redis';
import { InboundWebhookWorkflow } from '@/server/workflows/inboundWebhook';

import { getInboundWebhookKind } from './kinds';
import { refreshSubscription } from './kinds/mcpEvents/subscription';
import { removeInboundWebhook } from './lifecycle';
import {
  claimWebhookSignals,
  releaseWebhookSignalClaim,
  renewWebhookSignalClaim,
  settleWebhookSignals,
  WEBHOOK_WAKE_RENEW_MS,
} from './wakeClaim';

export async function scheduleInboundWebhookWake(id: string, delaySeconds = 10): Promise<void> {
  if (!(await redisService.inboundWebhook.claimWakeWindow(id))) return;
  try {
    await InboundWebhookWorkflow.triggerWake({ id }, delaySeconds);
  } catch (error) {
    console.error('[inboundWebhook:schedule] Could not enqueue wake', id);
    // The durable pending signal is retried by sweep even while the debounce claim is held.
    throw error;
  }
}

export interface WebhookWakeDeps {
  execute?: AiAgentService['execAgent'];
  intervention?: typeof resolveForegroundInterventionConfig;
}

/** Classify both thrown errors and execAgent's returned {error} shape, including nested causes. */
export function classifyWakeError(error: unknown): 'busy' | 'budget' | 'unknown' {
  let current = error;
  const visited = new Set<unknown>();
  while (!visited.has(current)) {
    visited.add(current);
    const text =
      typeof current === 'string'
        ? current
        : isRecord(current)
          ? `${String(current.name ?? '')} ${String(current.type ?? '')} ${String(current.message ?? '')}`
          : '';
    if (text.includes('TopicStartReservationError')) return 'busy';
    if (text.includes('InsufficientBudgetForAgentRunFee') || text.includes('insufficient_budget'))
      return 'budget';
    if (!isRecord(current)) break;
    current = current.cause ?? current.body;
  }
  return 'unknown';
}

/** Durable, renewable claims serialize a batch without holding a database lock during network I/O. */
export async function wakeInboundWebhook(
  db: LobeChatDatabase,
  id: string,
  deps: WebhookWakeDeps = {},
): Promise<{ outcome: string }> {
  let keyPromise: ReturnType<typeof KeyVaultsGateKeeper.initWithEnvKey> | undefined;
  const getGateKeeper = () => (keyPromise ??= KeyVaultsGateKeeper.initWithEnvKey());
  const found = await InboundWebhookModel.findForDelivery(db, id, getGateKeeper);
  if (!found) {
    await db
      .update(signals)
      .set({ error: 'webhook_removed', processedAt: new Date(), status: 'ignored' })
      .where(
        and(
          eq(signals.source, 'mcp-events'),
          eq(signals.scopeKey, `inbound-webhook:${id}`),
          inArray(signals.status, ['pending', 'failed']),
        ),
      );
    return { outcome: 'gone' };
  }
  const gateKeeper = await getGateKeeper();
  const { row } = found;
  if (row.status === 'pending') return { outcome: 'pending' };
  const kind = getInboundWebhookKind(row.kind);
  if (!kind) return { outcome: 'gone' };
  const scope = row.workspaceId ?? undefined;
  const topic = row.topicId
    ? await new TopicModel(db, row.userId, scope).findById(row.topicId)
    : undefined;
  const agentExists = await new AgentModel(db, row.userId, scope).existsById(row.agentId);
  if (!topic || topic.agentId !== row.agentId || !agentExists) {
    await removeInboundWebhook(db, row);
    await db
      .update(signals)
      .set({ error: 'target_removed', processedAt: new Date(), status: 'ignored' })
      .where(
        and(
          eq(signals.source, 'mcp-events'),
          eq(signals.scopeKey, `inbound-webhook:${id}`),
          inArray(signals.status, ['pending', 'failed']),
        ),
      );
    return { outcome: 'gone' };
  }
  const connector = row.connectorId
    ? await new ConnectorModel(db, row.userId, scope).findPublicById(row.connectorId)
    : null;

  const claim = await claimWebhookSignals(db, row);
  if (!claim) return { outcome: 'empty' };
  const { batch } = claim;
  const model = new InboundWebhookModel(db, row.userId, scope, gateKeeper);
  let handled = false;
  let leaseLost = false;
  let renewal: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewal) return;
    renewal = renewWebhookSignalClaim(db, claim)
      .then((owned) => {
        if (!owned) leaseLost = true;
      })
      .catch((error) => {
        leaseLost = true;
        console.error('[inboundWebhook:wake] Claim renewal failed', error);
      })
      .finally(() => {
        renewal = undefined;
      });
  }, WEBHOOK_WAKE_RENEW_MS);
  timer.unref?.();
  const ownsClaim = async () => !leaseLost && (await renewWebhookSignalClaim(db, claim));
  const settle = (
    status: 'pending' | 'processed' | 'ignored' | 'failed',
    reason: string,
    operationId?: string,
  ) => settleWebhookSignals(db, claim, batch, status, reason, operationId);
  try {
    if (!connector?.isEnabled) {
      await settle('ignored', 'connector_disabled');
      return { outcome: 'ignored' };
    }
    // Only authenticated control metadata can terminate a subscription. Payload fields are never control instructions.
    const termination = batch.find((s) => s.metadata.extra?.control === 'terminated');
    if (termination) {
      const error = termination.payload.error;
      const name = getMcpEventErrorName(error);
      let recovered = false;
      if (name === 'NotFound' || name === 'Unsupported') {
        if (!(await ownsClaim())) return { outcome: 'deferred' };
        try {
          const { connectorForWebhook } = await import('./kinds/mcpEvents/subscription');
          const { buildConnectorMcpParams } = await import('@/server/services/connector/sync');
          const { ensureFreshConnectorToken } = await import('@/server/services/connector/tokens');
          const { mcpService } = await import('@/server/services/mcp');
          const ctx = { db, model, row: claim.row };
          const { connector: c, connectorModel } = await connectorForWebhook(ctx);
          const fresh = await ensureFreshConnectorToken(c, connectorModel);
          const available = await mcpService.listEvents(buildConnectorMcpParams(fresh));
          if (
            available.some(
              (event) => event.name === row.config.eventName && event.delivery.includes('webhook'),
            )
          ) {
            if (!(await ownsClaim())) return { outcome: 'deferred' };
            await refreshSubscription(ctx);
            recovered = true;
          }
        } catch {
          console.error('[inboundWebhook:wake] Event rediscovery failed', id);
        }
      }
      if (recovered) {
        // Preserve any actual events in the same debounce window for the next run.
        await settleWebhookSignals(db, claim, [termination], 'ignored', 'subscription_recovered');
        return { outcome: 'recovered' };
      }
      const reason = name === 'Forbidden' ? 'access_revoked' : 'event_unavailable';
      termination.error = reason;
      await model.update(id, { lastError: reason, nextMaintenanceAt: null, status: 'terminated' });
    }
    const reserved = await model.reserveWake(id);
    if (!reserved) {
      await model.update(id, { lastError: 'wake_cap' });
      await settle('ignored', 'wake_cap');
      return { outcome: 'capped' };
    }
    const currentRow = claim.row;
    try {
      const execute =
        deps.execute ??
        (async (params) => {
          const { AiAgentService } = await import('@/server/services/aiAgent');
          return new AiAgentService(db, row.userId, { workspaceId: scope }).execAgent(params);
        });
      const userInterventionConfig = await (
        deps.intervention ?? resolveForegroundInterventionConfig
      )(db, row.userId);
      if (!(await ownsClaim())) {
        await model.releaseWake(id);
        return { outcome: 'deferred' };
      }
      const result = await execute({
        agentId: row.agentId,
        appContext: { topicId: row.topicId! },
        autoStart: true,
        markTopicRunning: true,
        externalOrigin: {
          kind: row.config.eventName,
          label: connector.name,
          provider: 'mcp-events',
          resourceId: row.id,
        },
        prompt: kind.buildPrompt({ connector, row: currentRow, signals: batch }),
        trigger: RequestTrigger.McpEvent,
        userInterventionConfig,
      });
      if (result.error) throw result.error;
      await settle('processed', 'event_delivery', result.operationId);
      handled = true;
      return { outcome: 'processed' };
    } catch (error) {
      const category = classifyWakeError(error);
      if (category === 'budget' || category === 'busy') await model.releaseWake(id);
      if (category === 'budget') {
        await model.update(id, { lastError: 'insufficient_budget' });
        await settle('failed', 'insufficient_budget');
      } else if (category === 'busy') await settle('pending', 'topic_busy');
      else {
        console.error('[inboundWebhook:wake] Agent start failed', id);
        await settle('failed', 'agent_start_failed');
      }
      return { outcome: category === 'busy' ? 'deferred' : 'failed' };
    }
  } finally {
    clearInterval(timer);
    await renewal;
    await releaseWebhookSignalClaim(db, claim, !handled);
  }
}
