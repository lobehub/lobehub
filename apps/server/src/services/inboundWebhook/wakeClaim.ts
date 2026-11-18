import { randomUUID } from 'node:crypto';

import type { SignalItem } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { SignalDecisionModel } from '@/database/models/signalDecision';
import { inboundWebhooks, signals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { getInboundWebhookKind } from './kinds';

export const WEBHOOK_WAKE_LEASE_MS = 5 * 60_000;
export const WEBHOOK_WAKE_RENEW_MS = 30_000;

export interface WebhookSignalClaim {
  batch: SignalItem[];
  row: InboundWebhookView;
  token: string;
  truncated: boolean;
}

const tokenOf = sql<string>`${signals.metadata} #>> '{extra,inboundWebhookWake,token}'`;
const leaseUntil = sql<number>`coalesce((${signals.metadata} #>> '{extra,inboundWebhookWake,leaseUntil}')::bigint, 0)`;
const withoutClaim = sql`jsonb_set(${signals.metadata}, '{extra}', coalesce(${signals.metadata}->'extra', '{}'::jsonb) - 'inboundWebhookWake')`;
const claimMetadata = (claim: { leaseUntil: number; token: string; truncated: boolean }) =>
  sql`jsonb_set(${signals.metadata}, '{extra}', coalesce(${signals.metadata}->'extra', '{}'::jsonb) || jsonb_build_object('inboundWebhookWake', ${JSON.stringify(claim)}::jsonb))`;

export interface ClaimWebhookSignalsOptions {
  /**
   * Narrow the claimable signals (oldest first) to the batch this wake runs; the rest stay free.
   * `leased` are the waiting signals another wake holds right now, so a kind can keep a group
   * (a thread) to one wake at a time.
   */
  group?: (candidates: SignalItem[], leased: SignalItem[]) => SignalItem[];
  /** `signals.source` of the row's kind; defaults to the registered kind's. */
  source?: string;
}

/** Commit a durable claim before doing any network I/O. Expired claims are recoverable by sweep. */
export async function claimWebhookSignals(
  db: LobeChatDatabase,
  row: InboundWebhookView,
  options: ClaimWebhookSignalsOptions = {},
): Promise<WebhookSignalClaim | undefined> {
  const now = Date.now();
  const token = randomUUID();
  const source = options.source ?? getInboundWebhookKind(row.kind)?.signalSource;
  if (!source) return undefined;
  return db.transaction(async (tx) => {
    // One claim per webhook at a time: a second wake waits here until this one's leases are
    // committed and visible, instead of claiming beside it from the same snapshot.
    const [target] = await tx
      .select({ id: inboundWebhooks.id })
      .from(inboundWebhooks)
      .where(
        and(
          eq(inboundWebhooks.id, row.id),
          eq(inboundWebhooks.userId, row.userId),
          inArray(inboundWebhooks.status, ['active', 'error', 'terminated', 'paused']),
        ),
      )
      .for('update');
    if (!target) return undefined;
    const waiting = and(
      eq(signals.source, source),
      eq(signals.scopeKey, `inbound-webhook:${row.id}`),
      eq(signals.userId, row.userId),
      or(eq(signals.status, 'pending'), and(eq(signals.status, 'failed'), lt(signals.attempts, 3))),
    );
    const candidates = await tx
      .select()
      .from(signals)
      .where(and(waiting, sql`${leaseUntil} <= ${now}`))
      .orderBy(asc(signals.occurredAt), asc(signals.createdAt))
      .limit(10_000)
      .for('update', { skipLocked: true });
    const leased = options.group
      ? await tx
          .select()
          .from(signals)
          .where(and(waiting, sql`${leaseUntil} > ${now}`))
          .limit(10_000)
      : [];
    // Rows left out of the group stay locked only until this short transaction ends.
    const batch = options.group ? options.group(candidates, leased) : candidates;
    if (!batch.length) return undefined;
    // Consume the gap flag under the row lock taken above. New gaps after commit set it again;
    // settlement never clears a newer receipt's flag. The claim retains it across crashes.
    const model = new InboundWebhookModel(
      tx as unknown as LobeChatDatabase,
      row.userId,
      row.workspaceId ?? undefined,
    );
    const current = (await model.findById(row.id))!;
    // Only an event stream (MCP) has a gap flag; other kinds never set it.
    const gapFlag = current.kind === 'mcp_events' && !!current.state.truncated;
    const truncated =
      gapFlag ||
      batch.some((signal) => {
        const previous = signal.metadata.extra?.inboundWebhookWake;
        return isRecord(previous) && previous.truncated === true;
      });
    if (gapFlag) await model.mergeState(row.id, { truncated: false });
    await tx
      .update(signals)
      .set({
        metadata: claimMetadata({ token, truncated, leaseUntil: now + WEBHOOK_WAKE_LEASE_MS }),
      })
      .where(
        inArray(
          signals.id,
          batch.map((signal) => signal.id),
        ),
      );
    const claimed: InboundWebhookView =
      current.kind === 'mcp_events'
        ? { ...current, state: { ...current.state, truncated } }
        : current;
    return { batch, row: claimed, token, truncated };
  });
}

/** Token fencing prevents a dead worker from renewing or settling a later worker's batch. */
export async function renewWebhookSignalClaim(
  db: LobeChatDatabase,
  claim: WebhookSignalClaim,
): Promise<boolean> {
  const rows = await db
    .update(signals)
    .set({
      metadata: claimMetadata({
        token: claim.token,
        truncated: claim.truncated,
        leaseUntil: Date.now() + WEBHOOK_WAKE_LEASE_MS,
      }),
    })
    .where(
      and(
        eq(signals.userId, claim.row.userId),
        inArray(
          signals.id,
          claim.batch.map((signal) => signal.id),
        ),
        eq(tokenOf, claim.token),
        inArray(signals.status, ['pending', 'failed']),
      ),
    )
    .returning({ id: signals.id });
  return rows.length === claim.batch.length;
}

/** Short, database-only settlement; an obsolete worker cannot change a reclaimed signal. */
export async function settleWebhookSignals(
  db: LobeChatDatabase,
  claim: WebhookSignalClaim,
  batch: SignalItem[],
  status: SignalItem['status'],
  reason: string,
  /** The run the batch started, and its Topic when the row has none of its own (generic). */
  run: { operationId?: string; topicId?: string } = {},
) {
  const topicId = run.topicId ?? claim.row.topicId ?? undefined;
  if (!batch.length) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(signals)
      .set({
        // `attempts` counts runs actually tried, and bounds failed ones. A busy Topic only defers
        // and an ignored delivery never tried, so neither spends that budget.
        ...((status === 'failed' || status === 'processed') && {
          attempts: sql`${signals.attempts} + 1`,
        }),
        error: status === 'processed' ? null : reason,
        metadata: withoutClaim,
        processedAt: status === 'pending' || status === 'failed' ? null : new Date(),
        status,
      })
      .where(
        and(
          eq(signals.userId, claim.row.userId),
          inArray(
            signals.id,
            batch.map((signal) => signal.id),
          ),
          eq(tokenOf, claim.token),
        ),
      )
      .returning({ id: signals.id });
    const changed = new Set(rows.map((signal) => signal.id));
    const model = new SignalDecisionModel(
      tx as unknown as LobeChatDatabase,
      claim.row.userId,
      claim.row.workspaceId ?? undefined,
    );
    for (const signal of batch.filter((signal) => changed.has(signal.id))) {
      const decision = await model.record({
        agentId: claim.row.agentId,
        finalReason: reason,
        outcome:
          status === 'processed'
            ? 'wake'
            : status === 'pending' || status === 'failed'
              ? 'defer'
              : 'skip',
        pipelineVersion: `inbound-webhook@1:attempt-${signal.attempts}`,
        scopeKey: `inbound-webhook:${claim.row.id}`,
        signalId: signal.id,
        topicId: topicId ?? null,
      });
      if (decision && run.operationId)
        await model.linkRun(decision.id, { operationId: run.operationId, topicId });
    }
  });
}

/** Release only our own remaining signals; preserve a consumed gap when no agent handled it. */
export async function releaseWebhookSignalClaim(
  db: LobeChatDatabase,
  claim: WebhookSignalClaim,
  restoreGap: boolean,
) {
  await db
    .update(signals)
    .set({ metadata: withoutClaim })
    .where(
      and(
        eq(signals.userId, claim.row.userId),
        inArray(
          signals.id,
          claim.batch.map((signal) => signal.id),
        ),
        eq(tokenOf, claim.token),
      ),
    );
  if (restoreGap && claim.truncated && claim.row.kind === 'mcp_events') {
    await new InboundWebhookModel(
      db,
      claim.row.userId,
      claim.row.workspaceId ?? undefined,
    ).mergeState(claim.row.id, { truncated: true });
  }
}
