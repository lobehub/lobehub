/**
 * Aico Phase 2 — RBAC / IDOR matrix + production gates + money wire
 * Maps: AICO-P1-001, AICO-P1-002, AICO-P1-014, AICO-P1-023, AICO-P1-026, AICO-P1-027
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aicoBillingRouter } from '../aicoBilling';
import { organizationRouter } from '../organization';
import { platformAdminRouter } from '../platformAdmin';
import { createTestContext } from './integration/setup';

process.env.KEY_VAULTS_SECRET = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

vi.mock('@/server/services/email', () => ({
  EmailService: class {
    sendMail = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/server/services/sms', () => ({
  SmsService: class {
    sendSms = vi.fn().mockResolvedValue(undefined);
  },
}));

const { disableAllOrgMemberKeysMock, reclaimMemberKeyMock } = vi.hoisted(() => ({
  disableAllOrgMemberKeysMock: vi.fn().mockResolvedValue([]),
  reclaimMemberKeyMock: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/server/services/openrouter/keyService', () => ({
  AicoOpenRouterKeyService: class {
    ensureUserKey = vi.fn().mockResolvedValue({ created: false, keyId: null });
    ensureMemberKey = vi.fn().mockResolvedValue({ created: false, keyId: null });
    disableMemberKey = vi.fn().mockResolvedValue(null);
    disableAllOrgMemberKeys = disableAllOrgMemberKeysMock;
    getUserRemaining = vi.fn().mockRejectedValue(new Error('not mocked'));
    reclaimMemberKey = reclaimMemberKeyMock;
    syncMemberUsage = vi.fn().mockResolvedValue(null);
  },
}));

const ownerId = 'p2-rbac-owner';
const ownerBId = 'p2-rbac-owner-b';
const memberId = 'p2-rbac-member';
const strangerId = 'p2-rbac-stranger';
const platformId = 'p2-rbac-platform';

const cleanup = async () => {
  const {
    memberBudgets,
    organizationInvites,
    organizationMembers,
    organizations,
    organizationTeamMembers,
    organizationTeams,
    platformAdmins,
    platformTrialConfig,
    trialAbuseBlocklist,
    usageLogs,
    userTrials,
    userWallets,
    walletTransactions,
  } = await import('@/database/schemas/aicoOrganization');
  const { users } = await import('@/database/schemas');
  await testDB.delete(usageLogs);
  await testDB.delete(trialAbuseBlocklist);
  await testDB.delete(userTrials);
  await testDB.delete(platformTrialConfig);
  await testDB.delete(walletTransactions);
  await testDB.delete(memberBudgets);
  await testDB.delete(organizationTeamMembers);
  await testDB.delete(organizationTeams);
  await testDB.delete(organizationInvites);
  await testDB.delete(organizationMembers);
  await testDB.delete(organizations);
  await testDB.delete(userWallets);
  await testDB.delete(platformAdmins);
  await testDB.delete(users);
};

beforeEach(async () => {
  disableAllOrgMemberKeysMock.mockClear();
  reclaimMemberKeyMock.mockClear();
  reclaimMemberKeyMock.mockResolvedValue(null);
  testDB = await getTestDB();
  await cleanup();
  const { users } = await import('@/database/schemas');
  await testDB.insert(users).values([
    {
      email: 'owner@rbac.test',
      id: ownerId,
      phone: '+989120000001',
      phoneNumberVerified: true,
    },
    {
      email: 'owner-b@rbac.test',
      id: ownerBId,
      phone: '+989120000002',
      phoneNumberVerified: true,
    },
    { email: 'member@rbac.test', id: memberId },
    { email: 'stranger@rbac.test', id: strangerId },
    { email: 'platform@rbac.test', id: platformId },
  ]);
  const { OrganizationModel } = await import('@/database/models/organization');
  const orgModel = new OrganizationModel(testDB);
  await orgModel.addPlatformAdmin(platformId);
}, 60_000);

afterEach(async () => {
  await cleanup();
});

describe('Aico RBAC / IDOR matrix (Phase 2)', () => {
  it('AICO-P1-001: mockTopup procedure is removed (platform-admin manual credit only)', () => {
    const src = readFileSync(path.join(__dirname, '../aicoBilling.ts'), 'utf8');
    expect(src).not.toMatch(/\bmockTopup\b/);
  });

  it('AICO-P1-002: mockOrgTopup procedure is removed (platform-admin manual credit only)', () => {
    const src = readFileSync(path.join(__dirname, '../organization.ts'), 'utf8');
    expect(src).not.toMatch(/\bmockOrgTopup\b/);
  });

  it('member cannot listMembers / getOrgWallet / allocate (IDOR deny)', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Member Deny Org' });
    const invite = await ownerCaller.inviteMember({
      identifierType: 'email',
      identifierValue: 'member@rbac.test',
      orgId: created.id,
      role: 'member',
    });
    const memberCaller = organizationRouter.createCaller(createTestContext(memberId));
    const token = invite.inviteUrl.split('/invite/').at(-1)!;
    await memberCaller.acceptInvite({ token });

    await expect(memberCaller.listMembers({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(memberCaller.getOrgWallet({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      memberCaller.getTransactionHistory({
        from: '2026-01-01',
        orgId: created.id,
        to: '2026-01-31',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      memberCaller.getOrgUsageChart({ from: '2026-01-01', orgId: created.id, to: '2026-01-31' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      memberCaller.allocateMemberCredit({
        amountUsd: '1.000000',
        orgId: created.id,
        orgMemberId: 'x',
        period: 'total',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('stranger cannot access another org by substituting orgId (IDOR)', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'IDOR Org' });
    const strangerCaller = organizationRouter.createCaller(createTestContext(strangerId));

    await expect(strangerCaller.listMembers({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(strangerCaller.getOrgWallet({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      strangerCaller.getTransactionHistory({
        from: '2026-01-01',
        orgId: created.id,
        to: '2026-01-31',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      strangerCaller.getMemberUsageChart({
        from: '2026-01-01',
        orgId: created.id,
        orgMemberId: 'x',
        to: '2026-01-31',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('org manager can load transaction history and usage charts for a date range', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Analytics Org' });
    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    await platformCaller.addManualCredit({
      amountToman: 25_000,
      description: 'analytics seed',
      orgId: created.id,
    });

    const today = new Date().toISOString().slice(0, 10);
    const history = await ownerCaller.getTransactionHistory({
      from: today,
      orgId: created.id,
      to: today,
    });
    expect(history.length).toBeGreaterThan(0);
    expect(typeof history[0]?.amountToman).toBe('string');
    expect(typeof history[0]?.amountUsd).toBe('string');

    const orgChart = await ownerCaller.getOrgUsageChart({
      from: today,
      orgId: created.id,
      to: today,
    });
    expect(orgChart).toHaveLength(1);
    expect(orgChart[0]?.date).toBe(today);
    expect(typeof orgChart[0]?.costUsd).toBe('string');

    const members = await ownerCaller.listMembers({ orgId: created.id });
    const ownerMember = members.members.find((m) => m.userId === ownerId)!;
    expect(ownerMember.email).toBe('owner@rbac.test');
    expect(ownerMember.username).toBeNull();
    const memberChart = await ownerCaller.getMemberUsageChart({
      from: today,
      orgId: created.id,
      orgMemberId: ownerMember.id,
      to: today,
    });
    expect(memberChart).toHaveLength(1);
  });

  it('TENANT-001/002: Org A manager cannot read or revoke Org B member budget by orgMemberId swap', async () => {
    const ownerA = organizationRouter.createCaller(createTestContext(ownerId));
    const ownerB = organizationRouter.createCaller(createTestContext(ownerBId));

    const orgA = await ownerA.create({ name: 'Tenant Org A' });
    const orgB = await ownerB.create({ name: 'Tenant Org B' });

    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    await platformCaller.addManualCredit({
      amountToman: 1_000_000,
      description: 'tenant isolation seed',
      orgId: orgB.id,
    });

    const invite = await ownerB.inviteMember({
      identifierType: 'email',
      identifierValue: 'member@rbac.test',
      orgId: orgB.id,
      role: 'member',
    });
    const memberCaller = organizationRouter.createCaller(createTestContext(memberId));
    const token = invite.inviteUrl.split('/invite/').at(-1)!;
    await memberCaller.acceptInvite({ token });

    const membersB = await ownerB.listMembers({ orgId: orgB.id });
    const orgBMember = membersB.members.find((m) => m.userId === memberId);
    expect(orgBMember).toBeTruthy();

    await ownerB.allocateMemberCredit({
      amountUsd: '1.000000',
      orgId: orgB.id,
      orgMemberId: orgBMember!.id,
      period: 'total',
    });

    // Same-org read still works for Org B owner.
    const ownBudget = await ownerB.getMemberBudget({
      orgId: orgB.id,
      orgMemberId: orgBMember!.id,
    });
    expect(ownBudget).toBeTruthy();
    expect(ownBudget!.periodAmountUsd).toBe('1.000000');

    // Cross-tenant read: Org A manager + Org B orgMemberId must not disclose budget.
    const leaked = await ownerA.getMemberBudget({
      orgId: orgA.id,
      orgMemberId: orgBMember!.id,
    });
    expect(leaked).toBeNull();

    // Cross-tenant write: must fail before OpenRouter reclaim is attempted.
    reclaimMemberKeyMock.mockClear();
    reclaimMemberKeyMock.mockResolvedValue({ remainingMicroUsd: 500_000, usageMicroUsd: 0 });

    await expect(
      ownerA.revokeMemberBudget({ orgId: orgA.id, orgMemberId: orgBMember!.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Member not found' });
    expect(reclaimMemberKeyMock).not.toHaveBeenCalled();
  });

  it('non-platform user cannot call platformAdmin mutations', async () => {
    const caller = platformAdminRouter.createCaller(createTestContext(strangerId));
    await expect(caller.listOrganizations({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.suspendOrganization({ orgId: 'any' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.addManualCredit({ amountToman: 1000, orgId: 'any' })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    await expect(
      caller.addManualUserCredit({ amountToman: 1000, email: 'stranger@rbac.test' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.listUserWallets()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform admin can manually credit a B2C user wallet by email', async () => {
    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    const result = await platformCaller.addManualUserCredit({
      amountToman: 50_000,
      description: 'Support credit',
      email: 'stranger@rbac.test',
    });
    expect(result.userId).toBe(strangerId);
    expect(result.transaction.type).toBe('manual_credit');
    expect(Number(result.wallet.balanceToman)).toBe(50_000);
    expect(Number(result.wallet.balanceMicroUsd)).toBeGreaterThan(0);

    const wallets = await platformCaller.listUserWallets();
    const wallet = wallets.find((w) => w.userId === strangerId);
    expect(wallet).toBeTruthy();
    expect(Number(wallet!.balanceToman)).toBe(50_000);
  });

  it('platform admin can suspend; member procedures still reachable on model (enforcement gap covered elsewhere)', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Suspend RBAC' });
    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    const row = await platformCaller.suspendOrganization({ orgId: created.id });
    expect(row.status).toBe('suspended');
    // Suspend must disable every member's OpenRouter key immediately (fail closed).
    expect(disableAllOrgMemberKeysMock).toHaveBeenCalledWith(created.id);
  });

  it('platform admin updateTrialConfig round-trips trialBudgetUsd as decimal string', async () => {
    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    const updated = await platformCaller.updateTrialConfig({ trialBudgetUsd: '2.500000' });
    expect(updated.trialBudgetUsd).toBe('2.500000');
    const fetched = await platformCaller.getTrialConfig();
    expect(fetched.trialBudgetUsd).toBe('2.500000');
  });

  it('platform admin listUserWallets and listOrganizations include publicCode', async () => {
    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    await platformCaller.addManualUserCredit({
      amountToman: 50_000,
      description: 'seed for publicCode',
      userId: strangerId,
    });
    const strangerCaller = aicoBillingRouter.createCaller(createTestContext(strangerId));
    // Public code is assigned lazily on first wallet view.
    await strangerCaller.getMyWallet();

    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    await ownerCaller.create({ name: 'PublicCode Org' });

    const wallets = await platformCaller.listUserWallets();
    const strangerWallet = wallets.find((w: any) => w.userId === strangerId);
    expect(strangerWallet?.publicCode).toMatch(/^USR/);
    expect(strangerWallet?.email).toBe('stranger@rbac.test');
    expect(strangerWallet?.username).toBeNull();

    const orgs = await platformCaller.listOrganizations({});
    expect(orgs.items.every((o: any) => typeof o.publicCode === 'string')).toBe(true);
  });

  it('AICO-P1-023: unverified phone cannot create organization', async () => {
    const caller = organizationRouter.createCaller(createTestContext(strangerId));
    // stranger has no verified phone — PRD requires phone verify for managers.
    await expect(caller.create({ name: 'No Phone Org' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('AICO-P1-026: inviteMember returns inviteUrl only; listMembers never leaks token', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Token Leak Org' });
    const invite = await ownerCaller.inviteMember({
      identifierType: 'email',
      identifierValue: 'member@rbac.test',
      orgId: created.id,
    });
    expect(invite.inviteUrl).toContain('/invite/');
    expect((invite as { token?: string }).token).toBeUndefined();

    const listed = await ownerCaller.listMembers({ orgId: created.id });
    expect(listed.invites.length).toBeGreaterThan(0);
    expect(listed.invites.every((i: any) => !('token' in i))).toBe(true);
  });

  it('AICO-92: getInviteLink reveals URL to managers; denies members/strangers; rejects revoked', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Reveal Link Org' });
    const invite = await ownerCaller.inviteMember({
      identifierType: 'email',
      identifierValue: 'reveal@rbac.test',
      orgId: created.id,
    });

    const revealed = await ownerCaller.getInviteLink({
      inviteId: invite.id,
      orgId: created.id,
    });
    expect(revealed.inviteUrl).toBe(invite.inviteUrl);
    expect(revealed.id).toBe(invite.id);
    expect((revealed as { token?: string }).token).toBeUndefined();

    // Accept as member so they become an org member without manager rights.
    const memberInvite = await ownerCaller.inviteMember({
      identifierType: 'email',
      identifierValue: 'member@rbac.test',
      orgId: created.id,
    });
    const memberCaller = organizationRouter.createCaller(createTestContext(memberId));
    await memberCaller.acceptInvite({
      token: memberInvite.inviteUrl.split('/invite/').at(-1)!,
    });
    await expect(
      memberCaller.getInviteLink({ inviteId: invite.id, orgId: created.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const strangerCaller = organizationRouter.createCaller(createTestContext(strangerId));
    await expect(
      strangerCaller.getInviteLink({ inviteId: invite.id, orgId: created.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const revoked = await ownerCaller.revokeInvite({
      inviteId: invite.id,
      orgId: created.id,
    });
    expect((revoked as { token?: string }).token).toBeUndefined();
    await expect(
      ownerCaller.getInviteLink({ inviteId: invite.id, orgId: created.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Invite is not pending' });
  });

  it('AICO-P1-018: getMyWallet returns string balances (micro-USD serialization)', async () => {
    const caller = aicoBillingRouter.createCaller(createTestContext(strangerId));
    const wallet = await caller.getMyWallet();
    expect(typeof wallet.balanceUsd).toBe('string');
    expect(typeof wallet.balanceToman).toBe('string');
    expect(typeof wallet.balanceMicroUsd).toBe('string');
  });

  it('getMyBillingSources returns personal and org sources with separate remaining', async () => {
    const { eq } = await import('drizzle-orm');
    const { AicoBillingModel } = await import('@/database/models/aicoBilling');
    const { OrganizationModel } = await import('@/database/models/organization');
    const { userWallets } = await import('@/database/schemas/aicoOrganization');

    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const billingCaller = aicoBillingRouter.createCaller(createTestContext(ownerId));
    const billingModel = new AicoBillingModel(testDB);
    const orgModel = new OrganizationModel(testDB);

    await billingModel.getOrCreateUserWallet(ownerId);
    await testDB
      .update(userWallets)
      .set({
        balanceMicroUsd: 1_500_000,
        balanceToman: 100_000,
        openrouterKeyId: 'pers-key',
      })
      .where(eq(userWallets.userId, ownerId));

    const org = await ownerCaller.create({ name: 'Billing Sources Co' });
    await orgModel.addManualCredit({
      amountMicroUsd: 10_000_000,
      amountToman: 500_000,
      createdByUserId: ownerId,
      description: 'test fund',
      fxRateTomanPerUsd: 50_000,
      orgId: org.id,
      type: 'topup',
    });

    const members = await orgModel.listMembers(org.id);
    const me = members.find((m) => m.userId === ownerId);
    expect(me).toBeTruthy();

    await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: me!.id,
      period: 'total',
      periodAmountMicroUsd: 5_000_000,
    });

    const sources = await billingCaller.getMyBillingSources();
    expect(sources.sources[0]?.source).toBe('personal');
    expect(sources.sources[0]?.remainingUsd).toBe('1.500000');

    const orgSource = sources.sources.find(
      (s) => s.source === 'organization' && s.organizationId === org.id,
    );
    expect(orgSource).toBeTruthy();
    expect(orgSource!.remainingUsd).toBe('5.000000');
    expect(orgSource!.remainingUsd).not.toBe(sources.sources[0]?.remainingUsd);

    await billingCaller.setBillingPreference({
      organizationId: org.id,
      source: 'organization',
    });
    const preferred = await billingCaller.getMyBillingSources();
    expect(preferred.preferredBillingSource).toBe('organization');
    expect(preferred.preferredOrganizationId).toBe(org.id);
  });

  it('convertToManagement requires a verified phone and rejects a second organization', async () => {
    const strangerCaller = organizationRouter.createCaller(createTestContext(strangerId));
    await expect(strangerCaller.convertToManagement({ name: 'No Phone Co' })).rejects.toMatchObject(
      { code: 'BAD_REQUEST', message: 'PHONE_VERIFICATION_REQUIRED' },
    );

    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const org = await ownerCaller.convertToManagement({ name: 'Verified Co' });
    expect(org.publicCode).toMatch(/^ORG/);

    // Owner already owns an org (created above) — a second upgrade must be rejected.
    await expect(ownerCaller.convertToManagement({ name: 'Second Co' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ALREADY_HAS_ORGANIZATION',
    });
  });

  it('removed member cannot manage org after disable', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Remove RBAC' });
    // promote stranger briefly as admin via platform
    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    const assigned = await platformCaller.assignManager({
      orgId: created.id,
      role: 'admin',
      userId: strangerId,
    });
    await ownerCaller.removeMember({ memberId: assigned.id, orgId: created.id });

    const strangerCaller = organizationRouter.createCaller(createTestContext(strangerId));
    await expect(strangerCaller.listMembers({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('only owner can soft-delete organization; admin and stranger are forbidden', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Delete Me Co' });

    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    await platformCaller.assignManager({
      orgId: created.id,
      role: 'admin',
      userId: memberId,
    });

    const adminCaller = organizationRouter.createCaller(createTestContext(memberId));
    await expect(
      adminCaller.deleteOrganization({ confirmName: 'Delete Me Co', orgId: created.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const strangerCaller = organizationRouter.createCaller(createTestContext(strangerId));
    await expect(
      strangerCaller.deleteOrganization({ confirmName: 'Delete Me Co', orgId: created.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      ownerCaller.deleteOrganization({ confirmName: 'Wrong', orgId: created.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'ORG_NAME_MISMATCH' });

    const deleted = await ownerCaller.deleteOrganization({
      confirmName: 'Delete Me Co',
      orgId: created.id,
    });
    expect(deleted.status).toBe('deleted');
    expect(disableAllOrgMemberKeysMock).toHaveBeenCalledWith(created.id);

    const mine = await ownerCaller.getMine();
    expect(mine.find((o) => o.id === created.id)).toBeUndefined();
  });
});
