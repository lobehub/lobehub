/**
 * AICO-140 — renewal prepaid-once, non-rollover, insufficient balance retry
 */
// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrganizationModel } from '@/database/models/organization';
import { users } from '@/database/schemas';
import {
  aicoKeyOutbox,
  aicoRenewalBatches,
  memberBudgets,
  organizationMembers,
  organizations,
  organizationTeamMembers,
  organizationTeams,
  walletTransactions,
} from '@/database/schemas/aicoOrganization';
import { processDueRenewals } from '@/server/services/aico/renewalScheduler';
import type { AicoOpenRouterKeyService } from '@/server/services/openrouter/keyService';

const usd = (n: number) => Math.round(n * 1_000_000);
const ownerId = 'aico-renewal-owner';
const memberUserId = 'aico-renewal-member';

describe('processDueRenewals (AICO-140)', () => {
  let serverDB: LobeChatDatabase;
  let orgModel: OrganizationModel;

  beforeEach(async () => {
    serverDB = await getTestDB();
    orgModel = new OrganizationModel(serverDB);
    await serverDB.delete(aicoKeyOutbox);
    await serverDB.delete(aicoRenewalBatches);
    await serverDB.delete(walletTransactions);
    await serverDB.delete(memberBudgets);
    await serverDB.delete(organizationTeamMembers);
    await serverDB.delete(organizationTeams);
    await serverDB.delete(organizationMembers);
    await serverDB.delete(organizations);
    await serverDB.delete(users);
    await serverDB.insert(users).values([
      { email: 'owner-r@example.com', id: ownerId },
      { email: 'member-r@example.com', id: memberUserId },
    ]);
  });

  afterEach(async () => {
    await serverDB.delete(aicoKeyOutbox);
    await serverDB.delete(aicoRenewalBatches);
    await serverDB.delete(walletTransactions);
    await serverDB.delete(memberBudgets);
    await serverDB.delete(organizationTeamMembers);
    await serverDB.delete(organizationTeams);
    await serverDB.delete(organizationMembers);
    await serverDB.delete(organizations);
    await serverDB.delete(users);
  });

  const setupDailyBudget = async (params: {
    capUsd: number;
    orgWalletUsd: number;
    settledUsageUsd?: number;
  }) => {
    const org = await orgModel.createOrganization({ name: 'Renew Co', ownerUserId: ownerId });
    if (params.orgWalletUsd > 0) {
      await orgModel.addManualCredit({
        amountMicroUsd: usd(params.orgWalletUsd),
        amountToman: Math.round(params.orgWalletUsd * 5000),
        createdByUserId: ownerId,
        fxRateTomanPerUsd: 5000,
        orgId: org.id,
      });
    }

    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'member-r@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });
    const { member } = await orgModel.acceptInvite({
      email: 'member-r@example.com',
      token: invite.token,
      userId: memberUserId,
    });

    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: member.id,
      period: 'daily',
      periodAmountMicroUsd: usd(params.capUsd),
    });

    const past = new Date(Date.now() - 60_000);
    await serverDB
      .update(memberBudgets)
      .set({
        nextRenewalAt: past,
        openrouterKeyCiphertext: 'cipher',
        openrouterKeyId: 'mock-key',
        settledUsageMicroUsd: usd(params.settledUsageUsd ?? 0),
      })
      .where(eq(memberBudgets.orgMemberId, member.id));

    return { member, org };
  };

  const mockKeyService = (opts: {
    remainingMicroUsd: number;
    usageMicroUsd: number;
  }): AicoOpenRouterKeyService =>
    ({
      disableMemberKey: vi.fn(async () => null),
      ensureMemberKey: vi.fn(async () => ({ created: false, keyId: 'mock-key' })),
      settleMemberPeriod: vi.fn(async () => ({
        remainingMicroUsd: opts.remainingMicroUsd,
        usageMicroUsd: opts.usageMicroUsd,
      })),
    }) as unknown as AicoOpenRouterKeyService;

  it('non-rollover: cap $5 spent $3 → org pays ~$3 and member returns to $5', async () => {
    const { member, org } = await setupDailyBudget({
      capUsd: 5,
      orgWalletUsd: 20,
      settledUsageUsd: 3,
    });
    const before = await orgModel.getById(org.id);
    expect(Number(before?.walletBalanceMicroUsd)).toBe(usd(15));

    const keyService = mockKeyService({
      remainingMicroUsd: usd(2),
      usageMicroUsd: usd(3),
    });

    const results = await processDueRenewals(serverDB, { keyService });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('funded');
    const after = await orgModel.getById(org.id);
    expect(Number(after?.walletBalanceMicroUsd)).toBe(usd(12));

    const budget = await orgModel.getMemberBudget(member.id);
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(5));
    expect(Number(budget?.reservedMicroUsd)).toBe(usd(5));
    expect(Number(budget?.settledUsageMicroUsd)).toBe(0);
    expect(budget?.pendingPeriod).toBeNull();
  });

  it('pending period change is prepaid once (no double debit at renewal)', async () => {
    const { member, org } = await setupDailyBudget({
      capUsd: 5,
      orgWalletUsd: 100,
      settledUsageUsd: 3,
    });
    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: member.id,
      period: 'weekly',
      periodAmountMicroUsd: usd(20),
    });
    const mid = await orgModel.getById(org.id);
    expect(Number(mid?.walletBalanceMicroUsd)).toBe(usd(75));

    const past = new Date(Date.now() - 60_000);
    await serverDB
      .update(memberBudgets)
      .set({ nextRenewalAt: past })
      .where(eq(memberBudgets.orgMemberId, member.id));

    const keyService = mockKeyService({
      remainingMicroUsd: usd(2),
      usageMicroUsd: usd(3),
    });
    const results = await processDueRenewals(serverDB, { keyService });
    expect(results[0].status).toBe('funded');
    const after = await orgModel.getById(org.id);
    expect(Number(after?.walletBalanceMicroUsd)).toBe(usd(77));

    const budget = await orgModel.getMemberBudget(member.id);
    expect(budget?.period).toBe('weekly');
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(20));
    expect(Number(budget?.reservedMicroUsd)).toBe(usd(20));
    expect(budget?.pendingPeriod).toBeNull();
  });

  it('insufficient balance fails atomically and retries after top-up', async () => {
    const { member, org } = await setupDailyBudget({
      capUsd: 5,
      orgWalletUsd: 5,
      settledUsageUsd: 5,
    });
    const keyService = mockKeyService({ remainingMicroUsd: 0, usageMicroUsd: usd(5) });
    let results = await processDueRenewals(serverDB, { keyService });
    expect(results[0].status).toBe('failed');

    let budget = await orgModel.getMemberBudget(member.id);
    expect(budget?.renewalStatus).toBe('renewal_failed');
    expect(budget?.isActive).toBe(false);
    expect(Number((await orgModel.getById(org.id))?.walletBalanceMicroUsd)).toBe(0);

    await orgModel.addManualCredit({
      amountMicroUsd: usd(10),
      amountToman: 50_000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });

    results = await processDueRenewals(serverDB, { keyService });
    expect(results[0].status).toBe('funded');
    budget = await orgModel.getMemberBudget(member.id);
    expect(budget?.renewalStatus).toBe('active');
    expect(budget?.isActive).toBe(true);
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(5));
  });

  it('concurrent processDueRenewals: one funded, one skipped', async () => {
    const { member, org } = await setupDailyBudget({
      capUsd: 5,
      orgWalletUsd: 20,
      settledUsageUsd: 3,
    });
    const keyService = mockKeyService({
      remainingMicroUsd: usd(2),
      usageMicroUsd: usd(3),
    });

    const [a, b] = await Promise.all([
      processDueRenewals(serverDB, { keyService }),
      processDueRenewals(serverDB, { keyService }),
    ]);

    const all = [...a, ...b];
    expect(all.filter((r) => r.status === 'funded')).toHaveLength(1);
    expect(all.filter((r) => r.status === 'failed')).toHaveLength(0);
    // Loser may skip on batch_key conflict, or see an empty due set after winner finishes.
    expect(all.filter((r) => r.status === 'skipped').length).toBeLessThanOrEqual(1);

    const after = await orgModel.getById(org.id);
    expect(Number(after?.walletBalanceMicroUsd)).toBe(usd(12));

    const budget = await orgModel.getMemberBudget(member.id);
    expect(budget?.renewalStatus).toBe('active');
    expect(Number(budget?.periodAmountMicroUsd)).toBe(usd(5));

    const batches = await serverDB.query.aicoRenewalBatches.findMany({
      where: eq(aicoRenewalBatches.orgId, org.id),
    });
    expect(batches).toHaveLength(1);
  });

  it('maps daily/weekly/monthly allocate to openrouterLimitReset', async () => {
    const cases = [
      { email: 'map-d@example.com', id: 'aico-map-daily', period: 'daily' as const },
      { email: 'map-w@example.com', id: 'aico-map-weekly', period: 'weekly' as const },
      { email: 'map-m@example.com', id: 'aico-map-monthly', period: 'monthly' as const },
    ];
    await serverDB.insert(users).values(cases.map((c) => ({ email: c.email, id: c.id })));

    const org = await orgModel.createOrganization({ name: 'Map Co', ownerUserId: ownerId });
    await orgModel.addManualCredit({
      amountMicroUsd: usd(30),
      amountToman: 150_000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });

    for (const c of cases) {
      const invite = await orgModel.createInvite({
        identifierType: 'email',
        identifierValue: c.email,
        invitedByUserId: ownerId,
        orgId: org.id,
        role: 'member',
      });
      const { member } = await orgModel.acceptInvite({
        email: c.email,
        token: invite.token,
        userId: c.id,
      });

      await orgModel.allocateMemberCredit({
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: member.id,
        period: c.period,
        periodAmountMicroUsd: usd(1),
      });
      const budget = await orgModel.getMemberBudget(member.id);
      expect(budget?.openrouterLimitReset).toBe(c.period);
      expect(budget?.period).toBe(c.period);
    }
  });
});
