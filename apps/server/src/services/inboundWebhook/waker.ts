import { isRecord } from '@lobechat/utils/object';
import { and, eq, inArray, lt, or } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { signals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AiAgentService } from '@/server/services/aiAgent';
import { resolveForegroundInterventionConfig } from '@/server/services/aiAgent/foregroundIntervention';
import { canPerformResourceAction, getResourceMeta } from '@/server/services/resourcePermission';

import {
  CHANNEL_DELIVERY_INSTRUCTION,
  CHANNEL_DELIVERY_INTERVENTION,
  createWebhookChannelReportHook,
} from './channelDelivery';
import { getInboundWebhookKind } from './kinds';
import type { InboundWebhookKindHandler } from './kinds/types';
import { removeInboundWebhook } from './lifecycle';
import { RUN_WINDOW_MS, RUNS_PER_WINDOW } from './limits';
import {
  claimWebhookSignals,
  releaseWebhookSignalClaim,
  renewWebhookSignalClaim,
  settleWebhookSignals,
  WEBHOOK_WAKE_RENEW_MS,
  type WebhookSignalClaim,
} from './wakeClaim';

/**
 * Runs one wake starts: one. Whatever else is waiting (another thread, or more calls than one
 * wake-up message carries) gets the next wake, which follows at once (`more`).
 */
export const MAX_RUNS_PER_WAKE = 1;
/** Groups one wake may try while the earlier ones cannot start (busy Topic, lost claim). */
const MAX_GROUP_ATTEMPTS_PER_WAKE = 10;

export interface WebhookWakeDeps {
  execute?: AiAgentService['execAgent'];
  intervention?: typeof resolveForegroundInterventionConfig;
}

/**
 * - `more`: this wake started its run and deliveries are still waiting; wake again now.
 * - `deferred`: retry later (busy Topic, lost claim).
 */
export interface WebhookWakeResult {
  outcome: string;
}

/** One claimed batch's result, with the group it ran, for kinds that run deliveries in groups. */
interface BatchResult extends WebhookWakeResult {
  groupKey?: string;
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

/** Whether deliveries are still waiting to run, after this wake started its one run. */
const stillWaiting = async (
  db: LobeChatDatabase,
  row: InboundWebhookView,
  kind: InboundWebhookKindHandler,
) => {
  const [left] = await db
    .select({ id: signals.id })
    .from(signals)
    .where(
      and(
        eq(signals.userId, row.userId),
        eq(signals.scopeKey, `inbound-webhook:${row.id}`),
        eq(signals.source, kind.signalSource),
        or(
          eq(signals.status, 'pending'),
          and(eq(signals.status, 'failed'), lt(signals.attempts, 3)),
        ),
      ),
    )
    .limit(1);
  return !!left;
};

/** Settle what is still waiting for a webhook that can no longer run anything. */
const ignoreWaiting = (db: LobeChatDatabase, id: string, reason: string) =>
  db
    .update(signals)
    .set({ error: reason, processedAt: new Date(), status: 'ignored' })
    .where(
      and(
        eq(signals.scopeKey, `inbound-webhook:${id}`),
        inArray(signals.status, ['pending', 'failed']),
      ),
    );

/**
 * Whether the webhook's owner may still run its agent, checked at every wake rather than once at
 * creation: a member removed from the workspace, or one whose access to the agent was taken away,
 * keeps the rows they created, and a call must not run the agent as them. Personal agents have no
 * one else to answer to.
 */
const ownerMayRun = async (db: LobeChatDatabase, row: InboundWebhookView) => {
  if (!row.workspaceId) return true;
  const meta = await getResourceMeta(db, 'agent', row.agentId);
  if (!meta) return false;
  return canPerformResourceAction({
    action: 'use',
    db,
    meta,
    resourceId: row.agentId,
    resourceType: 'agent',
    userId: row.userId,
    workspaceId: row.workspaceId,
  });
};

/**
 * Whether the subscription's Topic belongs to a task that has since been archived. Archived tasks
 * are hidden everywhere and every task run refuses them, so an event must not run one either.
 */
const inArchivedTask = async (db: LobeChatDatabase, row: InboundWebhookView) => {
  if (!row.topicId) return false;
  const scope = row.workspaceId ?? undefined;
  const link = await new TaskTopicModel(db, row.userId, scope).findByTopicId(row.topicId);
  if (!link) return false;
  return !!(await new TaskModel(db, row.userId, scope).findById(link.taskId))?.archivedAt;
};

/** Durable, renewable claims serialize a batch without holding a database lock during network I/O. */
export async function wakeInboundWebhook(
  db: LobeChatDatabase,
  id: string,
  deps: WebhookWakeDeps = {},
): Promise<WebhookWakeResult> {
  let keyPromise: ReturnType<typeof KeyVaultsGateKeeper.initWithEnvKey> | undefined;
  const getGateKeeper = () => (keyPromise ??= KeyVaultsGateKeeper.initWithEnvKey());
  const found = await InboundWebhookModel.findForDelivery(db, id, getGateKeeper);
  if (!found) {
    await ignoreWaiting(db, id, 'webhook_removed');
    return { outcome: 'gone' };
  }
  const gateKeeper = await getGateKeeper();
  const { row } = found;
  if (row.status === 'pending') return { outcome: 'pending' };
  const kind = getInboundWebhookKind(row.kind);
  if (!kind) return { outcome: 'gone' };
  const model = new InboundWebhookModel(db, row.userId, row.workspaceId ?? undefined, gateKeeper);
  const agentExists = await new AgentModel(db, row.userId, row.workspaceId ?? undefined).existsById(
    row.agentId,
  );
  if (!agentExists || !(await kind.targetExists({ db, model, row }))) {
    await removeInboundWebhook(db, row);
    await ignoreWaiting(db, id, 'target_removed');
    return { outcome: 'gone' };
  }
  // Kept, not deleted: access can come back, a task can be restored, and the owner or an admin
  // decides about the row.
  const held = !(await ownerMayRun(db, row))
    ? 'owner_access_revoked'
    : (await inArchivedTask(db, row))
      ? 'task_archived'
      : undefined;
  if (held) {
    await ignoreWaiting(db, id, held);
    return { outcome: 'ignored' };
  }
  const attempts = kind.groupSignals ? MAX_GROUP_ATTEMPTS_PER_WAKE : 1;
  let outcome = 'empty';
  // Groups this wake could not run (busy topic, failed start, lost claim). They wait for a later
  // wake; skipping them keeps one stuck thread from holding back the others behind it.
  const blocked = new Set<string>();
  let deferred = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const next = await wakeOnce(db, kind, row, model, deps, blocked);
    if (next.outcome === 'empty') return { outcome: deferred ? 'deferred' : outcome };
    outcome = next.outcome;
    // One run per wake: the rest, if any, is the next wake's.
    if (outcome === 'processed')
      return {
        outcome: kind.groupSignals && (await stillWaiting(db, row, kind)) ? 'more' : outcome,
      };
    // Settled without a run (paused, feature off): look at what else is waiting.
    if (outcome === 'ignored') continue;
    // The run window is the webhook's, not one group's: nothing else may run either.
    if (outcome === 'capped' || !next.groupKey) return { outcome };
    blocked.add(next.groupKey);
    if (outcome === 'deferred') deferred = true;
  }
  // A pass that only met busy or failing groups keeps their backoff, or it would retry the same
  // groups at once.
  return { outcome: deferred ? 'deferred' : outcome };
}

/** Claim one batch (a kind's group, or everything waiting) and start at most one run for it. */
async function wakeOnce(
  db: LobeChatDatabase,
  kind: InboundWebhookKindHandler,
  row: InboundWebhookView,
  model: InboundWebhookModel,
  deps: WebhookWakeDeps,
  blocked: ReadonlySet<string>,
): Promise<BatchResult> {
  const claim = await claimWebhookSignals(db, row, {
    // A group another wake holds is skipped too: its first run may still be creating the
    // thread's Topic, and a second run beside it would start another one.
    group: kind.groupSignals
      ? (candidates, leased) =>
          kind.groupSignals!(
            row,
            candidates,
            new Set([
              ...blocked,
              ...leased.flatMap((signal) => (kind.groupKey ? [kind.groupKey(row, signal)] : [])),
            ]),
          )
      : undefined,
    source: kind.signalSource,
  });
  if (!claim) return { outcome: 'empty' };
  const result = await runClaim(db, kind, row, model, deps, claim);
  const groupKey = kind.groupKey?.(row, claim.batch[0]);
  return groupKey ? { ...result, groupKey } : result;
}

/** Start the run for a claimed batch, settling every signal of it however that ends. */
async function runClaim(
  db: LobeChatDatabase,
  kind: InboundWebhookKindHandler,
  row: InboundWebhookView,
  model: InboundWebhookModel,
  deps: WebhookWakeDeps,
  claim: WebhookSignalClaim,
): Promise<WebhookWakeResult> {
  const { id } = row;
  const { batch } = claim;
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
    extra: { operationId?: string; signals?: typeof batch; topicId?: string } = {},
  ) =>
    settleWebhookSignals(db, claim, extra.signals ?? batch, status, reason, {
      operationId: extra.operationId,
      topicId: extra.topicId,
    });
  try {
    if (!(await kind.isEnabled(row.userId))) {
      await settle('ignored', 'feature_disabled');
      return { outcome: 'ignored' };
    }
    const intervention = deps.intervention ?? resolveForegroundInterventionConfig;
    const plan = await kind.planWake({
      batch,
      db,
      intervention,
      model,
      ownsClaim,
      row: claim.row,
      settle: (status, reason, subset) => settle(status, reason, { signals: subset }),
    });
    if ('outcome' in plan) return plan;
    const { run } = plan;
    const reserved = await model.reserveWake(id, RUNS_PER_WINDOW, RUN_WINDOW_MS);
    if (!reserved) {
      await model.update(id, { lastError: 'wake_cap' });
      await settle('ignored', 'wake_cap');
      return { outcome: 'capped' };
    }
    try {
      const execute =
        deps.execute ??
        (async (params) =>
          new AiAgentService(db, row.userId, {
            workspaceId: row.workspaceId ?? undefined,
          }).execAgent(params));
      if (!(await ownsClaim())) {
        await model.releaseWake(id, reserved);
        return { outcome: 'deferred' };
      }
      // A webhook that delivers to a Channel posts the run's answer there once it completes.
      const delivery = claim.row.config.delivery;
      const result = await execute({
        agentId: row.agentId,
        ...(run.topicId ? { appContext: { topicId: run.topicId } } : {}),
        autoStart: true,
        markTopicRunning: true,
        externalOrigin: run.externalOrigin,
        ...(delivery && {
          hooks: [createWebhookChannelReportHook(db, id)],
          instructions: CHANNEL_DELIVERY_INSTRUCTION,
        }),
        prompt: run.prompt,
        ...(run.title !== undefined ? { title: run.title } : {}),
        trigger: kind.trigger,
        userInterventionConfig: delivery
          ? CHANNEL_DELIVERY_INTERVENTION
          : run.userInterventionConfig,
        ...(run.webhookThread ? { webhookThread: run.webhookThread } : {}),
      });
      if (result.error) throw result.error;
      await settle('processed', 'event_delivery', {
        operationId: result.operationId,
        topicId: result.topicId ?? run.topicId,
      });
      handled = true;
      await model.recordRunStarted(id);
      return { outcome: 'processed' };
    } catch (error) {
      const category = classifyWakeError(error);
      if (category === 'budget' || category === 'busy') await model.releaseWake(id, reserved);
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
