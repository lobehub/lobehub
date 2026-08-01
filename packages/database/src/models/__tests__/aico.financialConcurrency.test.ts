/**
 * Aico Phase 2 — Financial concurrency & money invariants
 * Maps: AICO-P1-005, AICO-P1-016, AICO-P1-017, AICO-P1-018, AICO-P1-025
 */
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { walletTransactions } from '../../schemas/aicoOrganization';
import type { LobeChatDatabase } from '../../type';
import { OrganizationModel } from '../organization';
import { cleanupAicoTables, isServerDb, seedUsers } from './aico.phase2.helpers';

const serverDB: LobeChatDatabase = await getTestDB();
const orgModel = new OrganizationModel(serverDB);

const ownerId = 'p2-fin-owner';
const memberAId = 'p2-fin-member-a';
const memberBId = 'p2-fin-member-b';

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

const setupOrgWithUsd = async (usd: number) => {
  const org = await orgModel.createOrganization({ name: 'Fin Org', ownerUserId: ownerId });
  if (usd > 0) {
    await orgModel.addManualCredit({
      amountToman: Math.round(usd * 5000),
      amountUsd: usd,
      createdByUserId: ownerId,
      fxRate: 5000,
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
  /**
   * AICO-P1-005: Concurrent allocations must not overspend org USD.
   * Under PGlite, Promise.all may serialize; we also force stale reads to prove
   * allocateMemberCredit lacks atomic CAS / FOR UPDATE.
   */
  it('AICO-P1-005: parallel allocate 80+80 on 100 must not leave negative balance', async () => {
    const { memberA, memberB, org } = await setupOrgWithUsd(100);

    const results = await Promise.allSettled([
      orgModel.allocateMemberCredit({
        amountUsd: 80,
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
      }),
      orgModel.allocateMemberCredit({
        amountUsd: 80,
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberB.id,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    const final = await orgModel.getById(org.id);
    const balance = Number(final?.walletBalanceUsd);
    const allocateTxs = await serverDB.query.walletTransactions.findMany({
      where: eq(walletTransactions.orgId, org.id),
    });
    const allocateCount = allocateTxs.filter((t) => t.type === 'allocate').length;

    // Invariant: never negative; at most one of the 80s can succeed; conservation.
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(fulfilled.length + rejected.length).toBe(2);
    if (fulfilled.length === 2) {
      // Confirmed defect under concurrent or serialized-but-unsafe engine:
      // both succeeded → overspend. Keep assertion that proves safety requirement.
      expect.soft(balance).toBe(100 - 160); // documents actual overspend if both pass
    }
    expect(
      balance >= 0 && (fulfilled.length <= 1 || balance === 100 - 80 * fulfilled.length),
    ).toBeTruthy();

    // Hard safety invariant (must hold for release):
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(allocateCount).toBe(fulfilled.length);
    // Value conservation: starting 100 = remaining + allocated
    const allocatedSum = allocateTxs
      .filter((t) => t.type === 'allocate')
      .reduce((s, t) => s + Number(t.amountUsd), 0);
    expect(balance + allocatedSum).toBeCloseTo(100, 5);

    // The product invariant: at most one allocation of 80 may succeed from 100.
    expect(fulfilled.length).toBeLessThanOrEqual(1);
  });

  it('AICO-P1-005: stale-read injection proves missing CAS allows overspend', async () => {
    const { memberA, memberB, org } = await setupOrgWithUsd(100);

    // Force both transactions to observe walletBalanceUsd=100 regardless of prior debit.
    const originalTransaction = serverDB.transaction.bind(serverDB);
    let injectStale = true;
    (serverDB as any).transaction = async (fn: any) =>
      originalTransaction(async (tx: any) => {
        if (!injectStale) return fn(tx);
        const originalFindFirst = tx.query.organizations.findFirst.bind(tx.query.organizations);
        tx.query.organizations.findFirst = async (opts: any) => {
          const row = await originalFindFirst(opts);
          if (row && row.id === org.id) {
            return { ...row, walletBalanceUsd: 100 };
          }
          return row;
        };
        return fn(tx);
      });

    try {
      await orgModel.allocateMemberCredit({
        amountUsd: 80,
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
      });
      await orgModel.allocateMemberCredit({
        amountUsd: 80,
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberB.id,
      });
    } finally {
      (serverDB as any).transaction = originalTransaction;
      injectStale = false;
    }

    const final = await orgModel.getById(org.id);
    const balance = Number(final?.walletBalanceUsd);

    // Expected safe behavior: second allocate fails even if JS read is stale
    // (SQL WHERE wallet_balance_usd >= amount). Actual: negative balance.
    expect(balance).toBeGreaterThanOrEqual(0);
  });

  it('AICO-P1-005: many parallel allocations exceeding balance conserve non-negative USD', async () => {
    const { memberA, org } = await setupOrgWithUsd(50);
    const amounts = [20, 20, 20, 20, 20]; // total 100 > 50

    const results = await Promise.allSettled(
      amounts.map((amountUsd) =>
        orgModel.allocateMemberCredit({
          amountUsd,
          createdByUserId: ownerId,
          orgId: org.id,
          orgMemberId: memberA.id,
        }),
      ),
    );

    const final = await orgModel.getById(org.id);
    const balance = Number(final?.walletBalanceUsd);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const budget = await orgModel.getMemberBudget(memberA.id);

    expect(balance).toBeGreaterThanOrEqual(0);
    expect(Number(budget?.limitUsd ?? 0) + balance).toBeCloseTo(50, 5);
    expect(fulfilled).toBeLessThanOrEqual(2); // 20+20 = 40, third should fail
  });

  it('AICO-P1-005: rejects zero/negative/NaN-like allocate amounts', async () => {
    const { memberA, org } = await setupOrgWithUsd(10);

    await expect(
      orgModel.allocateMemberCredit({
        amountUsd: 0,
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
      }),
    ).rejects.toThrow(/positive/i);

    await expect(
      orgModel.allocateMemberCredit({
        amountUsd: -5,
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
      }),
    ).rejects.toThrow(/positive/i);

    // NaN must be rejected without mutating balance (financial safety).
    const before = await orgModel.getById(org.id);
    let threw = false;
    try {
      await orgModel.allocateMemberCredit({
        amountUsd: Number.NaN,
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: memberA.id,
      });
    } catch {
      threw = true;
    }
    const after = await orgModel.getById(org.id);
    const afterBal = Number(after?.walletBalanceUsd);
    expect(threw).toBe(true);
    expect(Number.isFinite(afterBal)).toBe(true);
    expect(afterBal).toBe(Number(before?.walletBalanceUsd));
  });

  it('AICO-P1-017: FX-style microdollar rounding does not invent money on allocate sums', async () => {
    const { memberA, org } = await setupOrgWithUsd(1);
    // Allocate tiny slices that stress float
    await orgModel.allocateMemberCredit({
      amountUsd: 0.1,
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
    });
    await orgModel.allocateMemberCredit({
      amountUsd: 0.2,
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
    });
    await orgModel.allocateMemberCredit({
      amountUsd: 0.3,
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
    });

    const final = await orgModel.getById(org.id);
    const budget = await orgModel.getMemberBudget(memberA.id);
    const remaining = Number(final?.walletBalanceUsd);
    const allocated = Number(budget?.limitUsd);
    expect(remaining + allocated).toBeCloseTo(1, 5);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  it('AICO-P1-025: allocate tx rows exist for every successful debit (append-only trail)', async () => {
    const { memberA, org } = await setupOrgWithUsd(30);
    await orgModel.allocateMemberCredit({
      amountUsd: 10,
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
    });
    await orgModel.allocateMemberCredit({
      amountUsd: 5,
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
    });

    const txs = await serverDB.query.walletTransactions.findMany({
      where: eq(walletTransactions.orgId, org.id),
    });
    const allocates = txs.filter((t) => t.type === 'allocate');
    expect(allocates).toHaveLength(2);
    expect(allocates.reduce((s, t) => s + Number(t.amountUsd), 0)).toBeCloseTo(15, 6);
  });

  it.skipIf(!isServerDb())(
    'AICO-P1-005 (server-db): genuine overlapping DB transactions with barrier',
    async () => {
      const { memberA, memberB, org } = await setupOrgWithUsd(100);

      // Hold a FOR UPDATE lock on org row, then fire two allocates that must contend.
      const barrier = Promise.withResolvers<void>();
      const hold = serverDB.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM organizations WHERE id = ${org.id} FOR UPDATE`);
        await barrier.promise;
      });

      const allocPromise = Promise.allSettled([
        orgModel.allocateMemberCredit({
          amountUsd: 80,
          createdByUserId: ownerId,
          orgId: org.id,
          orgMemberId: memberA.id,
        }),
        orgModel.allocateMemberCredit({
          amountUsd: 80,
          createdByUserId: ownerId,
          orgId: org.id,
          orgMemberId: memberB.id,
        }),
      ]);

      // Give allocate txs time to block on lock, then release.
      await new Promise((r) => setTimeout(r, 50));
      barrier.resolve();
      await hold;
      const results = await allocPromise;

      const final = await orgModel.getById(org.id);
      expect(Number(final?.walletBalanceUsd)).toBeGreaterThanOrEqual(0);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    },
  );
});

describe('Aico reclaim-on-revoke money invariants', () => {
  it('reclaimMemberRemainingCredit credits only the passed remainingUsd, never re-derives from usage', async () => {
    const { memberA, org } = await setupOrgWithUsd(100);
    await orgModel.allocateMemberCredit({
      amountUsd: 40,
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
    });
    // Simulate partial spend the caller (key service) observed on OpenRouter.
    await orgModel.syncMemberBudgetUsage({ orgMemberId: memberA.id, usedUsd: 15 });

    const beforeOrg = await orgModel.getById(org.id);
    const beforeBalance = Number(beforeOrg?.walletBalanceUsd);

    // Caller passes the OpenRouter-reported remaining credit (25), not (limit - used).
    const result = await orgModel.reclaimMemberRemainingCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      remainingUsd: 25,
    });

    expect(Number(result.organization.walletBalanceUsd)).toBeCloseTo(beforeBalance + 25, 6);

    const budget = await orgModel.getMemberBudget(memberA.id);
    expect(budget?.isActive).toBe(false);
    // Budget's limit collapses to usedUsd so it can never be re-spent via the old key.
    expect(Number(budget?.limitUsd)).toBeCloseTo(15, 6);
    expect(budget?.openrouterKeyId).toBeNull();
    expect(budget?.openrouterKeyHash).toBeNull();

    const txs = await serverDB.query.walletTransactions.findMany({
      where: eq(walletTransactions.orgId, org.id),
    });
    const reclaim = txs.find((t) => t.type === 'reclaim');
    expect(Number(reclaim?.amountUsd)).toBeCloseTo(25, 6);
  });

  it('reclaimMemberRemainingCredit clamps negative/non-finite remaining to 0 (never debits the org)', async () => {
    const { memberA, org } = await setupOrgWithUsd(50);
    await orgModel.allocateMemberCredit({
      amountUsd: 10,
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
    });
    const before = await orgModel.getById(org.id);

    const result = await orgModel.reclaimMemberRemainingCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: memberA.id,
      remainingUsd: Number.NaN,
    });

    expect(Number(result.organization.walletBalanceUsd)).toBeCloseTo(
      Number(before?.walletBalanceUsd),
      6,
    );
  });
});

describe('Aico money wire contract probes (Phase 2)', () => {
  it('AICO-P1-018: model returns numeric wallet fields today (contract expects strings)', async () => {
    const org = await orgModel.createOrganization({ name: 'Wire Org', ownerUserId: ownerId });
    await orgModel.addManualCredit({
      amountToman: 50_000,
      amountUsd: 10,
      createdByUserId: ownerId,
      fxRate: 5000,
      orgId: org.id,
    });
    const row = await orgModel.getById(org.id);
    // Technical contract: money as strings on the wire. Model currently uses numbers.
    // This assertion documents the defect — fails if still number.
    expect(typeof row?.walletBalanceUsd).toBe('string');
  });
});
