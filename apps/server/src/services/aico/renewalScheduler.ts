import { and, asc, eq, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';

import { OrganizationModel } from '@/database/models/organization';
import {
  aicoKeyOutbox,
  aicoRenewalBatches,
  memberBudgets,
  organizationMembers,
  organizations,
  walletTransactions,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { type BudgetPeriod, confirmedUnusedMicro } from '@/database/utils/aicoMoney';
import { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';

import { computePeriodWindow } from './periodBoundaries';

/** Outbox retry schedule: 1m, 2m, 4m … capped at 6h, then parked as `failed`. */
const OUTBOX_BASE_DELAY_MS = 60_000;
const OUTBOX_MAX_DELAY_MS = 6 * 60 * 60 * 1000;
const OUTBOX_MAX_ATTEMPTS = 12;
const OUTBOX_DEFAULT_BATCH = 25;

export interface RenewalOptions {
  keyService?: AicoOpenRouterKeyService;
  now?: Date;
}

export interface OrgRenewalResult {
  batchKey: string;
  grossRequiredMicroUsd: number;
  memberCount: number;
  orgId: string;
  refundedMicroUsd: number;
  shortfallMicroUsd: number;
  status: 'funded' | 'failed' | 'skipped';
}

interface DueBudget {
  budgetId: string;
  currentPeriod: BudgetPeriod;
  memberId: string;
  nextPeriod: BudgetPeriod;
  nextPeriodAmountMicroUsd: number;
  nextRenewalAt: Date;
  orgId: string;
  reservedMicroUsd: number;
}

const backoffMs = (attempts: number): number =>
  Math.min(OUTBOX_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), OUTBOX_MAX_DELAY_MS);

/**
 * Renews every member budget whose period boundary has passed.
 *
 * Money safety: per org, the whole cycle is one all-or-none batch keyed by
 * `org + boundary` — a unique `batch_key` makes a concurrent/duplicate run a
 * no-op, and the org wallet debit is a compare-and-swap so a partially funded
 * roster can never exist. If the wallet cannot cover the gross renewal, no
 * member is funded and every key in the batch is disabled via the outbox.
 */
export const processDueRenewals = async (
  db: LobeChatDatabase,
  options: RenewalOptions = {},
): Promise<OrgRenewalResult[]> => {
  const now = options.now ?? new Date();
  const keyService = options.keyService ?? new AicoOpenRouterKeyService(db);

  const rows = await db
    .select({ budget: memberBudgets, member: organizationMembers })
    .from(memberBudgets)
    .innerJoin(organizationMembers, eq(organizationMembers.id, memberBudgets.orgMemberId))
    .where(
      and(
        // `total` budgets never reset — they are settled manually on revoke/remove.
        ne(memberBudgets.period, 'total'),
        eq(memberBudgets.isActive, true),
        isNotNull(memberBudgets.nextRenewalAt),
        lte(memberBudgets.nextRenewalAt, now),
      ),
    );

  const byOrg = new Map<string, DueBudget[]>();
  for (const row of rows) {
    const nextPeriod = (row.budget.pendingPeriod ?? row.budget.period) as BudgetPeriod;
    const due: DueBudget = {
      budgetId: row.budget.id,
      currentPeriod: row.budget.period as BudgetPeriod,
      memberId: row.budget.orgMemberId,
      nextPeriod,
      nextPeriodAmountMicroUsd: Number(
        row.budget.pendingPeriodAmountMicroUsd ?? row.budget.periodAmountMicroUsd ?? 0,
      ),
      nextRenewalAt: row.budget.nextRenewalAt!,
      orgId: row.member.orgId,
      reservedMicroUsd: Number(row.budget.reservedMicroUsd ?? 0),
    };
    const list = byOrg.get(due.orgId);
    if (list) list.push(due);
    else byOrg.set(due.orgId, [due]);
  }

  const results: OrgRenewalResult[] = [];
  for (const [orgId, budgets] of byOrg) {
    results.push(await renewOrg({ budgets, db, keyService, now, orgId }));
  }
  return results;
};

const renewOrg = async (params: {
  budgets: DueBudget[];
  db: LobeChatDatabase;
  keyService: AicoOpenRouterKeyService;
  now: Date;
  orgId: string;
}): Promise<OrgRenewalResult> => {
  const { budgets, db, keyService, now, orgId } = params;

  const boundary = budgets
    .map((b) => b.nextRenewalAt.getTime())
    .reduce((min, t) => Math.min(min, t), Number.POSITIVE_INFINITY);
  const batchKey = `${orgId}:${new Date(boundary).toISOString()}`;
  const grossRequiredMicroUsd = budgets.reduce((sum, b) => sum + b.nextPeriodAmountMicroUsd, 0);

  // Unique `batch_key` is the idempotency guard: a second worker (or a retry of
  // the same boundary) inserts nothing and does no money movement.
  const [batch] = await db
    .insert(aicoRenewalBatches)
    .values({
      batchKey,
      grossRequiredMicroUsd,
      memberBudgetIds: budgets.map((b) => b.budgetId),
      orgId,
      status: 'pending',
    })
    .onConflictDoNothing({ target: aicoRenewalBatches.batchKey })
    .returning();

  if (!batch) {
    return {
      batchKey,
      grossRequiredMicroUsd,
      memberCount: budgets.length,
      orgId,
      refundedMicroUsd: 0,
      shortfallMicroUsd: 0,
      status: 'skipped',
    };
  }

  const budgetIds = budgets.map((b) => b.budgetId);

  // Deny chat for the whole roster while the boundary settles — a member must
  // never spend against an unfunded period.
  await db
    .update(memberBudgets)
    .set({ renewalStatus: 'renewal_pending' })
    .where(inArray(memberBudgets.id, budgetIds));

  const failBatch = async (error: string, shortfallMicroUsd = 0) => {
    await db
      .update(memberBudgets)
      .set({ isActive: false, renewalStatus: 'renewal_failed' })
      .where(inArray(memberBudgets.id, budgetIds));
    await db.insert(aicoKeyOutbox).values(
      budgets.map((b) => ({
        action: 'disable_member_key',
        nextAttemptAt: now,
        orgId,
        orgMemberId: b.memberId,
        payload: { batchKey, reason: error },
        status: 'pending',
      })),
    );
    await db
      .update(aicoRenewalBatches)
      .set({ error, shortfallMicroUsd, status: 'failed' })
      .where(eq(aicoRenewalBatches.id, batch.id));

    return {
      batchKey,
      grossRequiredMicroUsd,
      memberCount: budgets.length,
      orgId,
      refundedMicroUsd: 0,
      shortfallMicroUsd,
      status: 'failed' as const,
    };
  };

  // 1. Authoritative settlement of the closing period (OpenRouter is the source
  //    of truth for spend). Any read failure fails the batch — never guess usage.
  const refunds = new Map<string, number>();
  try {
    for (const b of budgets) {
      const settled = await keyService.settleMemberPeriod(b.memberId);
      const usage = BigInt(settled?.usageMicroUsd ?? 0);
      const unused =
        settled?.remainingMicroUsd == null
          ? confirmedUnusedMicro(BigInt(b.reservedMicroUsd), usage)
          : BigInt(Math.max(0, Math.floor(settled.remainingMicroUsd)));
      refunds.set(b.memberId, Number(unused));
    }
  } catch (error) {
    return failBatch(`SETTLEMENT_FAILED:${error instanceof Error ? error.message : String(error)}`);
  }

  const refundedMicroUsd = [...refunds.values()].reduce((sum, v) => sum + v, 0);

  // 2. Refund confirmed-unused credit, then take the gross renewal in a single
  //    compare-and-swap so the roster is funded all-or-none.
  try {
    await db.transaction(async (tx) => {
      if (refundedMicroUsd > 0) {
        await tx
          .update(organizations)
          .set({
            walletBalanceMicroUsd: sql`${organizations.walletBalanceMicroUsd} + ${refundedMicroUsd}`,
          })
          .where(eq(organizations.id, orgId));

        for (const b of budgets) {
          const amount = refunds.get(b.memberId) ?? 0;
          if (amount <= 0) continue;
          const member = await tx.query.organizationMembers.findFirst({
            where: eq(organizationMembers.id, b.memberId),
          });
          await tx.insert(walletTransactions).values({
            amountMicroUsd: amount,
            amountToman: 0,
            description: `Period refund for member ${b.memberId}`,
            orgId,
            orgMemberId: b.memberId,
            renewalBatchId: batch.id,
            type: 'period_refund',
            userId: member?.userId ?? null,
          });
        }
      }

      const [funded] = await tx
        .update(organizations)
        .set({
          walletBalanceMicroUsd: sql`${organizations.walletBalanceMicroUsd} - ${grossRequiredMicroUsd}`,
        })
        .where(
          and(
            eq(organizations.id, orgId),
            sql`${organizations.walletBalanceMicroUsd} >= ${grossRequiredMicroUsd}`,
          ),
        )
        .returning();
      if (!funded) throw new Error('INSUFFICIENT_ORG_BALANCE');

      for (const b of budgets) {
        const window = computePeriodWindow(b.nextPeriod, now);
        await tx
          .update(memberBudgets)
          .set({
            currentPeriodEnd: window.end,
            currentPeriodStart: window.start,
            nextRenewalAt: window.nextRenewalAt,
            pendingPeriod: null,
            pendingPeriodAmountMicroUsd: null,
            period: b.nextPeriod,
            periodAmountMicroUsd: b.nextPeriodAmountMicroUsd,
            refundedMicroUsd: sql`${memberBudgets.refundedMicroUsd} + ${refunds.get(b.memberId) ?? 0}`,
            renewalStatus: 'active',
            reservedMicroUsd: b.nextPeriodAmountMicroUsd,
            settledUsageMicroUsd: 0,
          })
          .where(eq(memberBudgets.id, b.budgetId));

        const member = await tx.query.organizationMembers.findFirst({
          where: eq(organizationMembers.id, b.memberId),
        });
        await tx.insert(walletTransactions).values({
          amountMicroUsd: b.nextPeriodAmountMicroUsd,
          amountToman: 0,
          description: `Period renewal for member ${b.memberId}`,
          orgId,
          orgMemberId: b.memberId,
          renewalBatchId: batch.id,
          type: 'period_renewal',
          userId: member?.userId ?? null,
        });
      }

      await tx
        .update(aicoRenewalBatches)
        .set({ refundedMicroUsd, status: 'funded' })
        .where(eq(aicoRenewalBatches.id, batch.id));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'INSUFFICIENT_ORG_BALANCE') {
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
      const balance = Number(org?.walletBalanceMicroUsd ?? 0);
      return failBatch('INSUFFICIENT_ORG_BALANCE', Math.max(0, grossRequiredMicroUsd - balance));
    }
    return failBatch(`RENEWAL_FAILED:${message}`);
  }

  // 3. Push the new limit + limit_reset to OpenRouter. A key that cannot be
  //    updated is left disabled and retried by the outbox rather than allowed to
  //    spend against a stale limit.
  for (const b of budgets) {
    try {
      await keyService.ensureMemberKey(b.memberId);
    } catch (error) {
      console.error('[aico] renewal key sync failed', b.memberId, error);
      await db
        .update(memberBudgets)
        .set({ renewalStatus: 'renewal_failed' })
        .where(eq(memberBudgets.id, b.budgetId));
      await db.insert(aicoKeyOutbox).values({
        action: 'disable_member_key',
        nextAttemptAt: now,
        orgId,
        orgMemberId: b.memberId,
        payload: { batchKey, reason: 'KEY_SYNC_FAILED' },
        status: 'pending',
      });
    }
  }

  return {
    batchKey,
    grossRequiredMicroUsd,
    memberCount: budgets.length,
    orgId,
    refundedMicroUsd,
    shortfallMicroUsd: 0,
    status: 'funded',
  };
};

export interface OutboxRunResult {
  failed: number;
  processed: number;
  succeeded: number;
}

/**
 * Drains the durable OpenRouter key outbox with exponential backoff.
 *
 * Local access removal (member removal, failed renewal) is committed
 * immediately; disabling the OpenRouter key and reclaiming credit happen here,
 * so OpenRouter downtime delays settlement but never blocks revocation.
 */
export const processKeyOutbox = async (
  db: LobeChatDatabase,
  options: { keyService?: AicoOpenRouterKeyService; limit?: number; now?: Date } = {},
): Promise<OutboxRunResult> => {
  const now = options.now ?? new Date();
  const keyService = options.keyService ?? new AicoOpenRouterKeyService(db);
  const orgModel = new OrganizationModel(db);

  const candidates = await db
    .select({ id: aicoKeyOutbox.id })
    .from(aicoKeyOutbox)
    .where(and(eq(aicoKeyOutbox.status, 'pending'), lte(aicoKeyOutbox.nextAttemptAt, now)))
    .orderBy(asc(aicoKeyOutbox.nextAttemptAt))
    .limit(options.limit ?? OUTBOX_DEFAULT_BATCH);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const candidate of candidates) {
    // Claim with a compare-and-swap so parallel workers never double-process.
    const [row] = await db
      .update(aicoKeyOutbox)
      .set({ attempts: sql`${aicoKeyOutbox.attempts} + 1`, status: 'processing' })
      .where(and(eq(aicoKeyOutbox.id, candidate.id), eq(aicoKeyOutbox.status, 'pending')))
      .returning();
    if (!row) continue;

    processed += 1;
    try {
      await runOutboxAction({ keyService, orgModel, row });
      await db
        .update(aicoKeyOutbox)
        .set({ lastError: null, status: 'succeeded' })
        .where(eq(aicoKeyOutbox.id, row.id));
      succeeded += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = row.attempts >= OUTBOX_MAX_ATTEMPTS;
      await db
        .update(aicoKeyOutbox)
        .set({
          alertedAt: exhausted ? now : null,
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
          status: exhausted ? 'failed' : 'pending',
        })
        .where(eq(aicoKeyOutbox.id, row.id));
      if (exhausted) {
        console.error('[aico] key outbox entry exhausted retries', row.id, row.action, message);
      }
    }
  }

  return { failed, processed, succeeded };
};

const runOutboxAction = async (params: {
  keyService: AicoOpenRouterKeyService;
  orgModel: OrganizationModel;
  row: typeof aicoKeyOutbox.$inferSelect;
}): Promise<void> => {
  const { keyService, orgModel, row } = params;

  switch (row.action) {
    case 'disable_member_key': {
      if (!row.orgMemberId) throw new Error('ORG_MEMBER_ID_REQUIRED');
      await keyService.disableMemberKey(row.orgMemberId);
      return;
    }

    case 'reclaim_member': {
      if (!row.orgMemberId || !row.orgId) throw new Error('ORG_MEMBER_ID_REQUIRED');
      const reclaimed = await keyService.reclaimMemberKey({
        orgId: row.orgId,
        orgMemberId: row.orgMemberId,
      });
      const createdByUserId =
        typeof row.payload?.createdByUserId === 'string' ? row.payload.createdByUserId : null;
      await orgModel.reclaimMemberRemainingCredit({
        createdByUserId,
        orgId: row.orgId,
        orgMemberId: row.orgMemberId,
        remainingMicroUsd: reclaimed?.remainingMicroUsd ?? 0,
      });
      await orgModel.finalizeMemberRevocation(row.orgMemberId);
      return;
    }

    default: {
      throw new Error(`UNSUPPORTED_OUTBOX_ACTION:${row.action}`);
    }
  }
};
