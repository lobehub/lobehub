/**
 * Aico Phase 2 — Financial concurrency & money invariants
 * Maps: AICO-P1-005, AICO-P1-016, AICO-P1-017, AICO-P1-018, AICO-P1-025
 * Plus AICO-105: FIN-001 (pending period), FIN-002 (reclaim CAS), FIN-003 (idempotency)
 */
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { memberBudgets, organizations, walletTransactions } from '../../schemas/aicoOrganization';
import type { LobeChatDatabase } from '../../type';
import { OrganizationModel } from '../organization';
import { cleanupAicoTables, isServerDb, seedUsers } from './aico.phase2.helpers';

const serverDB: LobeChatDatabase = await getTestDB();
const orgModel = new OrganizationModel(serverDB);

const ownerId = 'p2-fin-owner';
const memberAId = 'p2-fin-member-a';
const memberBId = 'p2-fin-member-b';

/** $1 = 1_000_000 micro-USD */
const usd = (n: number) => Math.round(n * 1_000_000);

beforeEach(async () => {
  await cleanupAicoTables(serverDB);
  await seedUsers(serverDB, [
    { email: 'fin-owner@example.com', id: ownerId },
    { email: 'fin-a@example.com', id: memberAId },
    { email: 'fin-b@example.com', id: memberBId },
  ]);
});

afterEach(async () => {
  await cleanupAicoTables(serverDB);
});

const setupOrgWithUsd = async (usdAmount: number) => {
  const org = await orgModel.createOrganization({ name: 'Fin Org', ownerUserId: ownerId });
  if (usdAmount > 0) {
    await orgModel.addManualCredit({
      amountMicroUsd: usd(usdAmount),
      amountToman: Math.round(usdAmount * 5000),
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });
  }
  const inviteA = await orgModel.createInvite({
    identifierType: 'email',
    identifierValue: 'fin-a@example.com',
    invitedByUserId: ownerId,
    orgId: org.id,
    role: 'member',
  });
  const inviteB = await orgModel.createInvite({
    identifierType: 'email',
    identifierValue: 'fin-b@example.com',
    invitedByUserId: ownerId,
    orgId: org.id,
    role: 'member',
  });
  const { member: memberA } = await orgModel.acceptInvite({
    email: 'fin-a@example.com',
    token: inviteA.token,
    userId: memberAId,
  });
  const { member: memberB } = await orgModel.acceptInvite({
    email: 'fin-b@example.com',
    token: inviteB.token,
    userId: memberBId,
  });
  return { memberA, memberB, org };
};

describe('Aico financial concurrency & money invariants (Phase 2)', () => {
  it('AICO-P1-005: parallel allocate 80+80 on 100 must not leave negative balance', async () => {
    const { memberA, memberB, org } = await setupOrgWithUsd(100);

    const results = await Promise.allSettled([
      orgModel.allocateMemberCredit({
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
        period: 'daily',
        periodAmountMicroUsd: usd(80),
      }),
      orgModel.allocateMemberCredit({
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberB.id,
        period: 'daily',
        periodAmountMicroUsd: usd(80),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    const final = await orgModel.getById(org.id);
    const balance = Number(final?.walletBalanceMicroUsd ?? 0);
    const allocateTxs = await serverDB.query.walletTransactions.findMany({
      where: eq(walletTransactions.orgId, org.id),
    });
    const allocateCount = allocateTxs.filter((t) => t.type === 'allocate').length;
    const allocatedSum = allocateTxs
      .filter((t) => t.type === 'allocate')
      .reduce((s, t) => s + Number(t.amountMicroUsd), 0);

    expect(balance).toBeGreaterThanOrEqual(0);
    expect(fulfilled.length + rejected.length).toBe(2);
    expect(fulfilled.length).toBeLessThanOrEqual(1);
    expect(allocateCount).toBe(fulfilled.length);
    // starting 100 USD = remaining + allocated (ignore manual_credit row)
    expect(balance + allocatedSum).toBe(usd(100));
  });

  it('AICO-P1-005: CAS still holds when JS read would be stale', async () => {
    const { memberA, memberB, org } = await setupOrgWithUsd(100);

    // Force both transactions to observe a stale high balance in the pre-check read.
    // The SQL WHERE wallet_balance_micro_usd >= amount must still prevent overspend.
    const originalTransaction = serverDB.transaction.bind(serverDB);
    (serverDB as { transaction: typeof serverDB.transaction }).transaction = async (fn) =>
      originalTransaction(async (tx) => {
        const originalFindFirst = tx.query.organizations.findFirst.bind(tx.query.organizations);
        tx.query.organizations.findFirst = async (opts) => {
          const row = await originalFindFirst(opts);
          if (row && row.id === org.id) {
            return { ...row, walletBalanceMicroUsd: usd(100) };
          }
          return row;
        };
        return fn(tx);
      });

    try {
      await orgModel.allocateMemberCredit({
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
        period: 'daily',
        periodAmountMicroUsd: usd(80),
      });
      await expect(
        orgModel.allocateMemberCredit({
          createdByUserId: ownerId,
          orgId: org.id,
          orgMemberId: memberB.id,
          period: 'daily',
          periodAmountMicroUsd: usd(80),
        }),
      ).rejects.toThrow(/INSUFFICIENT_ORG_BALANCE/);
    } finally {
      (serverDB as { transaction: typeof serverDB.transaction }).transaction = originalTransaction;
    }

    const final = await orgModel.getById(org.id);
    expect(Number(final?.walletBalanceMicroUsd)).toBe(usd(20));
  });

  it('AICO-P1-005: many parallel allocations exceeding balance conserve non-negative USD', async () => {
    const { memberA, org } = await setupOrgWithUsd(50);
    const amounts = [20, 20, 20, 20, 20]; // total 100 > 50

    const results = await Promise.allSettled(
      amounts.map((amount) =>
        orgModel.allocateMemberCredit({
          createdByUserId: ownerId,
          orgId: org.id,
          orgMemberId: memberA.id,
          period: 'daily',
          periodAmountMicroUsd: usd(amount),
        }),
      ),
    );

    const final = await orgModel.getById(org.id);
    const balance = Number(final?.walletBalanceMicroUsd ?? 0);
    const budget = await orgModel.getMemberBudget(memberA.id);

    expect(balance).toBeGreaterThanOrEqual(0);
    // set-cap: all target $20 — first debits $20; later identical sets are no-ops
    expect(Number(budget?.periodAmountMicroUsd ?? 0)).toBe(usd(20));
    expect(Number(budget?.periodAmountMicroUsd ?? 0) + balance).toBe(usd(50));
  });

  it('AICO-P1-005: rejects zero/negative allocate amounts', async () => {
    const { memberA, org } = await setupOrgWithUsd(10);

    await expect(
      orgModel.allocateMemberCredit({
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
        period: 'daily',
        periodAmountMicroUsd: 0,
      }),
    ).rejects.toThrow(/POSITIVE/i);

    await expect(
      orgModel.allocateMemberCredit({
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
        period: 'daily',
        periodAmountMicroUsd: -5,
      }),
    ).rejects.toThrow(/POSITIVE/i);
  });

  it('AICO-P1-017: micro-USD allocate set-cap conserves exactly', async () => {
    const { memberA, org } = await setupOrgWithUsd(1);
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: 100_000, // $0.10
    });
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: 200_000,
    });
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: 300_000,
    });

    const final = await orgModel.getById(org.id);
    const budget = await orgModel.getMemberBudget(memberA.id);
    const remaining = Number(final?.walletBalanceMicroUsd ?? 0);
    const allocated = Number(budget?.periodAmountMicroUsd ?? 0);
    // set-cap: deltas 100k + 100k + 100k = 300k reserved; wallet 700k
    expect(allocated).toBe(300_000);
    expect(remaining + allocated).toBe(usd(1));
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  it('AICO-P1-025: allocate tx rows exist for every successful debit', async () => {
    const { memberA, org } = await setupOrgWithUsd(30);
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(10),
    });
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(5),
    });

    const txs = await serverDB.query.walletTransactions.findMany({
      where: eq(walletTransactions.orgId, org.id),
    });
    const allocates = txs.filter((t) => t.type === 'allocate');
    expect(allocates).toHaveLength(2);
    expect(allocates.reduce((s, t) => s + Number(t.amountMicroUsd), 0)).toBe(usd(15));
  });

  it.skipIf(!isServerDb())(
    'AICO-P1-005 (server-db): genuine overlapping DB transactions with barrier',
    async () => {
      const { memberA, memberB, org } = await setupOrgWithUsd(100);

      const barrier = Promise.withResolvers<void>();
      const hold = serverDB.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM organizations WHERE id = ${org.id} FOR UPDATE`);
        await barrier.promise;
      });

      const allocPromise = Promise.allSettled([
        orgModel.allocateMemberCredit({
          createdByUserId: ownerId,
          orgId: org.id,
          orgMemberId: memberA.id,
          period: 'daily',
          periodAmountMicroUsd: usd(80),
        }),
        orgModel.allocateMemberCredit({
          createdByUserId: ownerId,
          orgId: org.id,
          orgMemberId: memberB.id,
          period: 'daily',
          periodAmountMicroUsd: usd(80),
        }),
      ]);

      await new Promise((r) => setTimeout(r, 50));
      barrier.resolve();
      await hold;
      const results = await allocPromise;

      const final = await orgModel.getById(org.id);
      expect(Number(final?.walletBalanceMicroUsd)).toBeGreaterThanOrEqual(0);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    },
  );
});

describe('AICO-105 FIN-001 pending period reservation', () => {
  it('period-type change queues pending without stacking reserved beyond current+pending', async () => {
    const { memberA, org } = await setupOrgWithUsd(100);
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(40),
    });

    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'monthly',
      periodAmountMicroUsd: usd(20),
    });

    let budget = await orgModel.getMemberBudget(memberA.id);
    expect(budget?.period).toBe('daily');
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(40));
    expect(budget?.pendingPeriod).toBe('monthly');
    expect(Number(budget?.pendingPeriodAmountMicroUsd)).toBe(usd(20));
    expect(Number(budget?.reservedMicroUsd)).toBe(usd(60));

    // Replace pending — refund prior pending, do not stack.
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'weekly',
      periodAmountMicroUsd: usd(10),
    });

    budget = await orgModel.getMemberBudget(memberA.id);
    expect(budget?.pendingPeriod).toBe('weekly');
    expect(Number(budget?.pendingPeriodAmountMicroUsd)).toBe(usd(10));
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(40));
    expect(Number(budget?.reservedMicroUsd)).toBe(usd(50));

    const orgRow = await orgModel.getById(org.id);
    // 100 - 40 - 20 + 20 (refund) - 10 = 50
    expect(Number(orgRow?.walletBalanceMicroUsd)).toBe(usd(50));
  });

  it('rejects legacy total period on new allocate', async () => {
    const { memberA, org } = await setupOrgWithUsd(10);
    await expect(
      orgModel.allocateMemberCredit({
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
        period: 'total',
        periodAmountMicroUsd: usd(5),
      }),
    ).rejects.toThrow(/PERIOD_NOT_ALLOWED/);
  });

  it('legacy total → daily applies immediately without stuck pending', async () => {
    const { memberA, org } = await setupOrgWithUsd(100);
    // Grandfathered total budget (cannot be created via allocate).
    await serverDB.insert(memberBudgets).values({
      isActive: true,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'total',
      periodAmountMicroUsd: usd(40),
      renewalStatus: 'active',
      reservedMicroUsd: usd(40),
    });
    await serverDB
      .update(organizations)
      .set({ walletBalanceMicroUsd: usd(60) })
      .where(eq(organizations.id, org.id));

    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(25),
    });

    const budget = await orgModel.getMemberBudget(memberA.id);
    expect(budget?.period).toBe('daily');
    expect(budget?.pendingPeriod).toBeNull();
    expect(budget?.pendingPeriodAmountMicroUsd).toBeNull();
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(25));
    expect(Number(budget?.reservedMicroUsd)).toBe(usd(25));
    expect(budget?.openrouterLimitReset).toBe('daily');
    expect(budget?.nextRenewalAt).toBeTruthy();

    const orgRow = await orgModel.getById(org.id);
    // 60 + 15 (refund delta 40→25) = 75
    expect(Number(orgRow?.walletBalanceMicroUsd)).toBe(usd(75));
  });

  it('dashboard shortfall excludes prepaid pending next-cap', async () => {
    const { memberA, memberB, org } = await setupOrgWithUsd(100);
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(40),
    });
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'monthly',
      periodAmountMicroUsd: usd(20),
    });
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberB.id,
      period: 'weekly',
      periodAmountMicroUsd: usd(10),
    });

    const stats = await orgModel.getOrgDashboardStats(org.id);
    // A: prepaid pending → 0 at renewal; B: no pending → 10
    expect(stats.grossNextRenewalMicroUsd).toBe(usd(10));
    // wallet = 100 - 40 - 20 - 10 = 30; shortfall = max(0, 10 - 30) = 0
    expect(stats.shortfallMicroUsd).toBe(0);
  });

  it('same-period allocate sets cap instead of topping up', async () => {
    const { memberA, org } = await setupOrgWithUsd(100);
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(5),
    });
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(10),
    });
    const budget = await orgModel.getMemberBudget(memberA.id);
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(10));
    const orgRow = await orgModel.getById(org.id);
    // 100 - 5 - 5 (delta) = 90
    expect(Number(orgRow?.walletBalanceMicroUsd)).toBe(usd(90));
  });
});

describe('AICO-105 FIN-002 reclaim idempotency', () => {
  it('reclaimMemberRemainingCredit credits only once under double call', async () => {
    const { memberA, org } = await setupOrgWithUsd(100);
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(40),
    });

    const before = await orgModel.getById(org.id);
    const beforeBalance = Number(before?.walletBalanceMicroUsd ?? 0);

    const first = await orgModel.reclaimMemberRemainingCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      remainingMicroUsd: usd(25),
    });
    expect(Number(first.organization.walletBalanceMicroUsd)).toBe(beforeBalance + usd(25));
    expect(first.transaction).toBeTruthy();

    const second = await orgModel.reclaimMemberRemainingCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      remainingMicroUsd: usd(25),
    });
    // Second reclaim must not invent another +25.
    expect(Number(second.organization.walletBalanceMicroUsd)).toBe(beforeBalance + usd(25));
    expect(second.transaction).toBeNull();

    const budget = await orgModel.getMemberBudget(memberA.id);
    expect(budget?.renewalStatus).toBe('settled');
    expect(budget?.isActive).toBe(false);
    expect(Number(budget?.reservedMicroUsd)).toBe(0);

    const txs = await serverDB.query.walletTransactions.findMany({
      where: eq(walletTransactions.orgId, org.id),
    });
    expect(txs.filter((t) => t.type === 'reclaim')).toHaveLength(1);
  });

  it('reclaimMemberRemainingCredit clamps non-positive remaining to 0', async () => {
    const { memberA, org } = await setupOrgWithUsd(50);
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(10),
    });
    const before = await orgModel.getById(org.id);

    const result = await orgModel.reclaimMemberRemainingCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      remainingMicroUsd: Number.NaN as unknown as number,
    });

    expect(Number(result.organization.walletBalanceMicroUsd)).toBe(
      Number(before?.walletBalanceMicroUsd),
    );
  });
});

describe('AICO-105 FIN-003 credit/allocate idempotency keys', () => {
  it('addManualCredit with same idempotencyKey does not double credit', async () => {
    const org = await orgModel.createOrganization({ name: 'Idem Org', ownerUserId: ownerId });
    const key = 'idem-org-credit-001';

    const first = await orgModel.addManualCredit({
      amountMicroUsd: usd(10),
      amountToman: 50_000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      idempotencyKey: key,
      orgId: org.id,
    });
    const second = await orgModel.addManualCredit({
      amountMicroUsd: usd(10),
      amountToman: 50_000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      idempotencyKey: key,
      orgId: org.id,
    });

    expect(second.transaction.id).toBe(first.transaction.id);
    expect(Number(second.organization.walletBalanceMicroUsd)).toBe(usd(10));
  });

  it('allocateMemberCredit with same idempotencyKey does not double allocate', async () => {
    const { memberA, org } = await setupOrgWithUsd(50);
    const key = 'idem-allocate-001';

    const first = await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      idempotencyKey: key,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(10),
    });
    const second = await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      idempotencyKey: key,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(10),
    });

    expect(second.transaction.id).toBe(first.transaction.id);
    const orgRow = await orgModel.getById(org.id);
    expect(Number(orgRow?.walletBalanceMicroUsd)).toBe(usd(40));
    const budget = await orgModel.getMemberBudget(memberA.id);
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(10));
  });
});

describe('AICO-105 FIN-005 wallet tx balance audit trail', () => {
  it('addManualCredit records previous and new org balances', async () => {
    const org = await orgModel.createOrganization({ name: 'Audit Org', ownerUserId: ownerId });
    await orgModel.addManualCredit({
      amountMicroUsd: usd(20),
      amountToman: 100_000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });

    const { organization, transaction } = await orgModel.addManualCredit({
      amountMicroUsd: usd(5),
      amountToman: 25_000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });

    expect(transaction.balanceBeforeMicroUsd).toBe(usd(20));
    expect(transaction.balanceAfterMicroUsd).toBe(usd(25));
    expect(transaction.balanceBeforeToman).toBe(100_000);
    expect(transaction.balanceAfterToman).toBe(125_000);
    expect(Number(organization.walletBalanceMicroUsd)).toBe(usd(25));
  });

  it('allocateMemberCredit and reclaimMemberRemainingCredit record balance snapshots', async () => {
    const { memberA, org } = await setupOrgWithUsd(50);

    const allocated = await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      period: 'daily',
      periodAmountMicroUsd: usd(20),
    });
    expect(allocated.transaction.balanceBeforeMicroUsd).toBe(usd(50));
    expect(allocated.transaction.balanceAfterMicroUsd).toBe(usd(30));

    const reclaimed = await orgModel.reclaimMemberRemainingCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      remainingMicroUsd: usd(12),
    });
    expect(reclaimed.transaction).not.toBeNull();
    expect(reclaimed.transaction!.balanceBeforeMicroUsd).toBe(usd(30));
    expect(reclaimed.transaction!.balanceAfterMicroUsd).toBe(usd(42));
  });
});
