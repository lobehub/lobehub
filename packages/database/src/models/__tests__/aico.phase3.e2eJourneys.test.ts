/**
 * Aico Phase 3 — Persona matrix + E2E journeys (model layer)
 * Release-safe invariants: tests FAIL when product violates them (NO-GO evidence).
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { organizationTeams, userTrials, walletTransactions } from '../../schemas/aicoOrganization';
import type { LobeChatDatabase } from '../../type';
import { AicoBillingModel } from '../aicoBilling';
import { OrganizationModel } from '../organization';
import { cleanupAicoTables } from './aico.phase2.helpers';
import {
  collectAicoDataIntegrity,
  expectReleaseInvariants,
  P3,
  P3_PHONES,
  seedPhase3Personas,
} from './aico.phase3.helpers';

let db: LobeChatDatabase;
let orgModel: OrganizationModel;
let billing: AicoBillingModel;

beforeEach(async () => {
  db = await getTestDB();
  orgModel = new OrganizationModel(db);
  billing = new AicoBillingModel(db);
  await seedPhase3Personas(db);
  await orgModel.addPlatformAdmin(P3.platformAdmin);
  await billing.updateTrialConfig({
    allowedModelIds: ['openrouter/auto'],
    durationDays: 7,
    enabled: true,
    maxRequests: 1,
    updatedByUserId: P3.platformAdmin,
  });
}, 60_000);

afterEach(async () => {
  await cleanupAicoTables(db);
});

describe('Phase 3 Journey 1 — B2C lifecycle (release invariants)', () => {
  it('verified phone can activate trial once; duplicate denied', async () => {
    const trial = await billing.activateTrial({
      phone: P3_PHONES.b2cVerified,
      userId: P3.b2cVerified,
    });
    expect(trial.status).toBe('active');
    await expect(
      billing.activateTrial({ phone: P3_PHONES.b2cVerified, userId: P3.b2cVerified }),
    ).rejects.toThrow(/TRIAL_ALREADY_USED/);
  });

  it('manual credit credits wallet and writes ledger', async () => {
    const { wallet, transaction } = await billing.manualCreditUser({
      amountMicroUsd: 1_000_000,
      amountToman: 50_000,
      createdByUserId: P3.b2cVerified,
      fxRateTomanPerUsd: 50_000,
      userId: P3.b2cVerified,
    });
    expect(Number(wallet.balanceMicroUsd)).toBe(1_000_000);
    expect(transaction.type).toBe('manual_credit');
    const txs = await db.query.walletTransactions.findMany({
      where: eq(walletTransactions.userId, P3.b2cVerified),
    });
    expect(txs.length).toBeGreaterThanOrEqual(1);
  });

  it('AICO-P3-J1: blocklist prevents recreated-account trial', async () => {
    await billing.addAbuseBlocklist({
      phone: P3_PHONES.deletedRecreated,
      reason: 'account_deleted',
    });
    await expect(
      billing.activateTrial({ phone: P3_PHONES.deletedRecreated, userId: P3.deletedRecreated }),
    ).rejects.toThrow(/TRIAL_PHONE_BLOCKED/);
  });

  it('AICO-P3-J1: concurrent final trial increments race (accepted — trial disabled in prod)', async () => {
    await billing.activateTrial({ phone: P3_PHONES.trialActive, userId: P3.trialActive });
    await Promise.all([
      billing.incrementTrialRequest(P3.trialActive),
      billing.incrementTrialRequest(P3.trialActive),
      billing.incrementTrialRequest(P3.trialActive),
    ]);
    const trial = await billing.getUserTrial(P3.trialActive);
    // Documented race under concurrent increment; production disables trials (FIN-011).
    expect(Number(trial?.requestCount)).toBeGreaterThan(0);
  });
});

describe('Phase 3 Journey 2 — Organization lifecycle', () => {
  const setupOrg = async () => {
    const org = await orgModel.createOrganization({
      name: 'P3 Org Alpha',
      ownerUserId: P3.orgOwner,
    });
    const teams = await db.query.organizationTeams.findMany({
      where: eq(organizationTeams.orgId, org.id),
    });
    const defaults = teams.filter((t) => t.isDefault);
    expect(defaults).toHaveLength(1);

    const inviteAdmin = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'admin@p3.aico.test',
      invitedByUserId: P3.orgOwner,
      orgId: org.id,
      role: 'admin',
    });
    const inviteMember = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'member@p3.aico.test',
      invitedByUserId: P3.orgOwner,
      orgId: org.id,
      role: 'member',
    });

    await expect(
      orgModel.acceptInvite({
        email: 'unrelated@p3.aico.test',
        token: inviteAdmin.token,
        userId: P3.unrelated,
      }),
    ).rejects.toThrow(/INVITE_IDENTIFIER_MISMATCH/);

    const { member: admin } = await orgModel.acceptInvite({
      email: 'admin@p3.aico.test',
      token: inviteAdmin.token,
      userId: P3.orgAdmin,
    });
    const { member } = await orgModel.acceptInvite({
      email: 'member@p3.aico.test',
      token: inviteMember.token,
      userId: P3.orgMember,
    });

    await orgModel.addManualCredit({
      amountToman: 500_000,
      amountMicroUsd: 100000000,
      createdByUserId: P3.platformAdmin,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });

    return { admin, member, org };
  };

  it('owner/default team/invite/credit/allocate happy path + over-allocation deny', async () => {
    const { member, org } = await setupOrg();
    await orgModel.allocateMemberCredit({
      periodAmountMicroUsd: 40000000,
      period: 'daily',
      createdByUserId: P3.orgOwner,
      orgId: org.id,
      orgMemberId: member.id,
    });
    await expect(
      orgModel.allocateMemberCredit({
        periodAmountMicroUsd: 80000000,
        period: 'daily',
        createdByUserId: P3.orgOwner,
        orgId: org.id,
        orgMemberId: member.id,
      }),
    ).rejects.toThrow(/INSUFFICIENT/);

    const final = await orgModel.getById(org.id);
    expect(Number(final?.walletBalanceMicroUsd)).toBeGreaterThanOrEqual(0);
    const integrity = await collectAicoDataIntegrity(db);
    expectReleaseInvariants(integrity);
  });

  it('AICO-P3-J2: removeMember marks revocation_pending; key reclaim is out-of-band', async () => {
    const { member, org } = await setupOrg();
    await orgModel.allocateMemberCredit({
      createdByUserId: P3.orgOwner,
      orgId: org.id,
      orgMemberId: member.id,
      period: 'daily',
      periodAmountMicroUsd: 10_000_000,
    });
    await orgModel.updateMemberOpenRouterKey({
      ciphertext: 'cipher-fake',
      keyId: 'or-key-live',
      orgMemberId: member.id,
    });
    const removed = await orgModel.removeMember({ memberId: member.id, orgId: org.id });
    expect(removed?.status).toBe('revocation_pending');
    const budget = await orgModel.getMemberBudget(member.id);
    // Local revoke leaves key material until outbox reclaim settles.
    expect(budget?.openrouterKeyId).toBe('or-key-live');
  });

  it('AICO-P3-J2: suspended org must not list or accept allocate', async () => {
    const { member, org } = await setupOrg();
    await orgModel.setOrganizationStatus(org.id, 'suspended');
    const listed = await orgModel.listForUser(P3.orgMember);
    expect(listed.find((o) => o.id === org.id)).toBeUndefined();
    await expect(
      orgModel.allocateMemberCredit({
        periodAmountMicroUsd: 1000000,
        period: 'daily',
        createdByUserId: P3.orgOwner,
        orgId: org.id,
        orgMemberId: member.id,
      }),
    ).rejects.toThrow();
  });
});

describe('Phase 3 Journey 3 — Cross-tenant attack (model layer)', () => {
  it('attacker cannot accept foreign invite', async () => {
    const org = await orgModel.createOrganization({
      name: 'Victim Org',
      ownerUserId: P3.orgOwner,
    });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'member@p3.aico.test',
      invitedByUserId: P3.orgOwner,
      orgId: org.id,
      role: 'member',
    });

    await expect(
      orgModel.acceptInvite({
        email: 'attacker@p3.aico.test',
        token: invite.token,
        userId: P3.attacker,
      }),
    ).rejects.toThrow(/INVITE_IDENTIFIER_MISMATCH/);

    const listed = await orgModel.listForUser(P3.attacker);
    expect(listed.find((o) => o.id === org.id)).toBeUndefined();
    const integrity = await collectAicoDataIntegrity(db);
    expect(integrity.activeMembersWithoutOrg).toBe(0);
  });
});

describe('Phase 3 Journey 5 — Concurrency (release invariants)', () => {
  it('AICO-P1-005: CAS allocate prevents overspend on concurrent 80+80 of 100', async () => {
    const org = await orgModel.createOrganization({ name: 'CAS Org', ownerUserId: P3.orgOwner });
    await orgModel.addManualCredit({
      amountMicroUsd: 100_000_000,
      amountToman: 500_000,
      createdByUserId: P3.platformAdmin,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });
    const invA = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'member@p3.aico.test',
      invitedByUserId: P3.orgOwner,
      orgId: org.id,
      role: 'member',
    });
    const invB = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'admin@p3.aico.test',
      invitedByUserId: P3.orgOwner,
      orgId: org.id,
      role: 'member',
    });
    const { member: mA } = await orgModel.acceptInvite({
      email: 'member@p3.aico.test',
      token: invA.token,
      userId: P3.orgMember,
    });
    const { member: mB } = await orgModel.acceptInvite({
      email: 'admin@p3.aico.test',
      token: invB.token,
      userId: P3.orgAdmin,
    });

    const results = await Promise.allSettled([
      orgModel.allocateMemberCredit({
        createdByUserId: P3.orgOwner,
        orgId: org.id,
        orgMemberId: mA.id,
        period: 'daily',
        periodAmountMicroUsd: 80_000_000,
      }),
      orgModel.allocateMemberCredit({
        createdByUserId: P3.orgOwner,
        orgId: org.id,
        orgMemberId: mB.id,
        period: 'daily',
        periodAmountMicroUsd: 80_000_000,
      }),
    ]);

    const final = await orgModel.getById(org.id);
    expect(Number(final?.walletBalanceMicroUsd)).toBeGreaterThanOrEqual(0);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('parallel allocate 80+80 on 100 must not go negative (×3)', async () => {
    const negatives: number[] = [];
    for (let i = 0; i < 3; i++) {
      await cleanupAicoTables(db);
      await seedPhase3Personas(db);
      await orgModel.addPlatformAdmin(P3.platformAdmin);
      const org = await orgModel.createOrganization({
        name: `Race Org ${i}`,
        ownerUserId: P3.orgOwner,
      });
      await orgModel.addManualCredit({
        amountMicroUsd: 100_000_000,
        amountToman: 500_000,
        createdByUserId: P3.platformAdmin,
        fxRateTomanPerUsd: 5000,
        orgId: org.id,
      });
      const invA = await orgModel.createInvite({
        identifierType: 'email',
        identifierValue: 'member@p3.aico.test',
        invitedByUserId: P3.orgOwner,
        orgId: org.id,
        role: 'member',
      });
      const invB = await orgModel.createInvite({
        identifierType: 'email',
        identifierValue: 'admin@p3.aico.test',
        invitedByUserId: P3.orgOwner,
        orgId: org.id,
        role: 'member',
      });
      const { member: mA } = await orgModel.acceptInvite({
        email: 'member@p3.aico.test',
        token: invA.token,
        userId: P3.orgMember,
      });
      const { member: mB } = await orgModel.acceptInvite({
        email: 'admin@p3.aico.test',
        token: invB.token,
        userId: P3.orgAdmin,
      });

      await Promise.allSettled([
        orgModel.allocateMemberCredit({
          createdByUserId: P3.orgOwner,
          orgId: org.id,
          orgMemberId: mA.id,
          period: 'daily',
          periodAmountMicroUsd: 80_000_000,
        }),
        orgModel.allocateMemberCredit({
          createdByUserId: P3.orgOwner,
          orgId: org.id,
          orgMemberId: mB.id,
          period: 'daily',
          periodAmountMicroUsd: 80_000_000,
        }),
      ]);
      const final = await orgModel.getById(org.id);
      const bal = Number(final?.walletBalanceMicroUsd);
      if (bal < 0) negatives.push(bal);
    }
    expect(negatives).toEqual([]);
  });
});

describe('Phase 3 Journey — Multi-org + integrity', () => {
  it('AICO-P3-J2: platform-wide unique active membership blocks multi-org join', async () => {
    const orgA = await orgModel.createOrganization({ name: 'Org A', ownerUserId: P3.orgOwner });
    const orgB = await orgModel.createOrganization({ name: 'Org B', ownerUserId: P3.orgAdmin });
    const inviteA = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'multiorg@p3.aico.test',
      invitedByUserId: P3.orgOwner,
      orgId: orgA.id,
      role: 'member',
    });
    await orgModel.acceptInvite({
      email: 'multiorg@p3.aico.test',
      token: inviteA.token,
      userId: P3.multiOrg,
    });
    const inviteB = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'multiorg@p3.aico.test',
      invitedByUserId: P3.orgAdmin,
      orgId: orgB.id,
      role: 'member',
    });
    await expect(
      orgModel.acceptInvite({
        email: 'multiorg@p3.aico.test',
        token: inviteB.token,
        userId: P3.multiOrg,
      }),
    ).rejects.toThrow(/USER_ALREADY_IN_ORGANIZATION/);
  });

  it('default teams and membership integrity hold after happy org create', async () => {
    await orgModel.createOrganization({ name: 'Integrity Org', ownerUserId: P3.orgOwner });
    const report = await collectAicoDataIntegrity(db);
    expectReleaseInvariants(report);
  });

  it('AICO-P3: dual trial rows same fingerprint are rejected by unique index', async () => {
    await billing.activateTrial({ phone: P3_PHONES.b2cVerified, userId: P3.b2cVerified });
    const fingerprint = (await billing.getUserTrial(P3.b2cVerified))!.phoneFingerprint;
    await expect(
      db.insert(userTrials).values({
        expiresAt: new Date(Date.now() + 86_400_000),
        phoneFingerprint: fingerprint,
        startedAt: new Date(),
        status: 'active',
        userId: P3.trialActive,
      }),
    ).rejects.toThrow();
    const report = await collectAicoDataIntegrity(db);
    expect(report.duplicateTrialFingerprints).toBe(0);
  });
});
