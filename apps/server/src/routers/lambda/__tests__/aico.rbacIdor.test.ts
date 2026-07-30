/**
 * Aico Phase 2 — RBAC / IDOR matrix + production gates + money wire
 * Maps: AICO-P1-001, AICO-P1-002, AICO-P1-014, AICO-P1-023, AICO-P1-026, AICO-P1-027
 */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';

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

vi.mock('@/server/services/openrouter/keyService', () => ({
  AicoOpenRouterKeyService: class {
    ensureUserKey = vi.fn().mockResolvedValue({ created: false, keyId: null });
    ensureMemberKey = vi.fn().mockResolvedValue({ created: false, keyId: null });
  },
}));

const ownerId = 'p2-rbac-owner';
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
  testDB = await getTestDB();
  await cleanup();
  const { users } = await import('@/database/schemas');
  await testDB.insert(users).values([
    { email: 'owner@rbac.test', id: ownerId, phoneNumberVerified: false },
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
  it('AICO-P1-001: mockTopup is callable by any authenticated user (must be production-forbidden)', async () => {
    const caller = aicoBillingRouter.createCaller(createTestContext(strangerId));
    const result = await caller.mockTopup({ amountToman: 100_000 });
    // Invariant for release: must throw FORBIDDEN in production-like deploys.
    // Actual: credits stranger wallet.
    expect(result.balanceUsd).toBeGreaterThan(0);
    // Explicit production gate probe:
    const gatedInProduction = false;
    expect(gatedInProduction).toBe(true);
  });

  it('AICO-P1-002: org owner can mockOrgTopup (must be platform-admin-only / prod-forbidden)', async () => {
    const orgCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await orgCaller.create({ name: 'RBAC Org' });
    const topup = await orgCaller.mockOrgTopup({ amountToman: 100_000, orgId: created.id });
    expect(topup.balanceUsd).toBeGreaterThan(0);
    const gatedInProduction = false;
    expect(gatedInProduction).toBe(true);
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
    await memberCaller.acceptInvite({ token: invite.token });

    await expect(memberCaller.listMembers({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(memberCaller.getOrgWallet({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      memberCaller.allocateMemberCredit({
        amountUsd: 1,
        orgId: created.id,
        orgMemberId: 'x',
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
      strangerCaller.mockOrgTopup({ amountToman: 1000, orgId: created.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('non-platform user cannot call platformAdmin mutations', async () => {
    const caller = platformAdminRouter.createCaller(createTestContext(strangerId));
    await expect(caller.listOrganizations({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.suspendOrganization({ orgId: 'any' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.addManualCredit({ amountToman: 1000, orgId: 'any' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.listUserWallets()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('platform admin can suspend; member procedures still reachable on model (enforcement gap covered elsewhere)', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Suspend RBAC' });
    const platformCaller = platformAdminRouter.createCaller(createTestContext(platformId));
    const row = await platformCaller.suspendOrganization({ orgId: created.id });
    expect(row.status).toBe('suspended');
  });

  it('AICO-P1-023: unverified phone can still create organization', async () => {
    const caller = organizationRouter.createCaller(createTestContext(ownerId));
    // owner has phoneNumberVerified: false
    const org = await caller.create({ name: 'No Phone Org' });
    // PRD requires phone verify for managers — create must reject.
    expect(org.id).toBeUndefined();
  });

  it('AICO-P1-026: inviteMember response includes raw token', async () => {
    const ownerCaller = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await ownerCaller.create({ name: 'Token Leak Org' });
    const invite = await ownerCaller.inviteMember({
      identifierType: 'email',
      identifierValue: 'member@rbac.test',
      orgId: created.id,
    });
    expect(invite.token).toBeTruthy();
    const listed = await ownerCaller.listMembers({ orgId: created.id });
    expect(listed.invites.some((i: any) => i.token)).toBe(true);
    // Safety: list must omit raw tokens
    expect(listed.invites.every((i: any) => !i.token)).toBe(true);
  });

  it('AICO-P1-018: getMyWallet returns number balances (contract expects strings)', async () => {
    const caller = aicoBillingRouter.createCaller(createTestContext(strangerId));
    const wallet = await caller.getMyWallet();
    expect(typeof wallet.balanceUsd).toBe('string');
    expect(typeof wallet.balanceToman).toBe('string');
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
});
