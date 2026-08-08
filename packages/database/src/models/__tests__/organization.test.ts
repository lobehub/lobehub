import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
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
} from '../../schemas/aicoOrganization';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import { AicoBillingModel, fingerprintPhone } from '../aicoBilling';
import { DEFAULT_TEAM_NAME, OrganizationModel } from '../organization';

const serverDB: LobeChatDatabase = await getTestDB();
const orgModel = new OrganizationModel(serverDB);
const billingModel = new AicoBillingModel(serverDB);

const ownerId = 'aico-org-owner';
const adminId = 'aico-org-admin';
const memberId = 'aico-org-member';

beforeEach(async () => {
  await serverDB.delete(trialAbuseBlocklist);
  await serverDB.delete(userTrials);
  await serverDB.delete(platformTrialConfig);
  await serverDB.delete(usageLogs);
  await serverDB.delete(userWallets);
  await serverDB.delete(walletTransactions);
  await serverDB.delete(organizationTeamMembers);
  await serverDB.delete(organizationTeams);
  await serverDB.delete(organizationInvites);
  await serverDB.delete(organizationMembers);
  await serverDB.delete(organizations);
  await serverDB.delete(platformAdmins);
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'owner@example.com', id: ownerId },
    { email: 'admin@example.com', id: adminId },
    { email: 'member@example.com', id: memberId, phone: '+989121234567' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(trialAbuseBlocklist);
  await serverDB.delete(userTrials);
  await serverDB.delete(platformTrialConfig);
  await serverDB.delete(usageLogs);
  await serverDB.delete(userWallets);
  await serverDB.delete(walletTransactions);
  await serverDB.delete(organizationTeamMembers);
  await serverDB.delete(organizationTeams);
  await serverDB.delete(organizationInvites);
  await serverDB.delete(organizationMembers);
  await serverDB.delete(organizations);
  await serverDB.delete(platformAdmins);
  await serverDB.delete(users);
});

describe('OrganizationModel', () => {
  it('creates org with owner membership and default Unspecified team', async () => {
    const org = await orgModel.createOrganization({ name: 'Acme Co', ownerUserId: ownerId });
    expect(org.slug).toBeTruthy();
    expect(org.ownerUserId).toBe(ownerId);

    const role = await orgModel.getMemberRole(ownerId, org.id);
    expect(role).toBe('owner');

    const teams = await orgModel.listTeams(org.id);
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe(DEFAULT_TEAM_NAME);
    expect(teams[0].isDefault).toBe(true);

    const members = await orgModel.listMembers(org.id);
    const team = await orgModel.getMemberTeam(members[0].id);
    expect(team?.id).toBe(teams[0].id);
  });

  it('platform admin helpers', async () => {
    expect(await orgModel.isPlatformAdmin(ownerId)).toBe(false);
    await orgModel.addPlatformAdmin(ownerId);
    expect(await orgModel.isPlatformAdmin(ownerId)).toBe(true);
  });

  it('invite + accept by email attaches default team', async () => {
    const org = await orgModel.createOrganization({ name: 'Invite Org', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });

    const result = await orgModel.acceptInvite({
      email: 'member@example.com',
      token: invite.token,
      userId: memberId,
    });

    expect(result.orgId).toBe(org.id);
    expect(result.member.status).toBe('active');
    expect(await orgModel.getMemberRole(memberId, org.id)).toBe('member');

    const team = await orgModel.getMemberTeam(result.member.id);
    expect(team?.isDefault).toBe(true);
  });

  it('rejects invite identifier mismatch', async () => {
    const org = await orgModel.createOrganization({ name: 'Mismatch Org', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });

    await expect(
      orgModel.acceptInvite({
        email: 'wrong@example.com',
        token: invite.token,
        userId: memberId,
      }),
    ).rejects.toThrow('INVITE_IDENTIFIER_MISMATCH');
  });

  it('assignManager and manual credit with USD', async () => {
    const org = await orgModel.createOrganization({ name: 'Credit Org', ownerUserId: ownerId });
    await orgModel.assignManager({ orgId: org.id, role: 'admin', userId: adminId });
    expect(await orgModel.getMemberRole(adminId, org.id)).toBe('admin');

    const { organization, transaction } = await orgModel.addManualCredit({
      amountMicroUsd: 10_000_000,
      amountToman: 50_000,
      createdByUserId: ownerId,
      description: 'test credit',
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });
    expect(transaction.type).toBe('manual_credit');
    expect(organization.walletBalanceToman).toBe(50_000);
    expect(Number(organization.walletBalanceMicroUsd)).toBe(10_000_000);
  });

  it('allocates member credit from org wallet without over-allocating', async () => {
    const org = await orgModel.createOrganization({ name: 'Alloc Org', ownerUserId: ownerId });
    await orgModel.addManualCredit({
      amountMicroUsd: 20_000_000,
      amountToman: 100_000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });

    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });
    const { member } = await orgModel.acceptInvite({
      email: 'member@example.com',
      token: invite.token,
      userId: memberId,
    });

    const { budget, organization } = await orgModel.allocateMemberCredit({
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: member.id,
      period: 'total',
      periodAmountMicroUsd: 10_000_000,
    });
    expect(Number(budget.periodAmountMicroUsd)).toBe(10_000_000);
    expect(Number(organization.walletBalanceMicroUsd)).toBe(10_000_000);

    await expect(
      orgModel.allocateMemberCredit({
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: member.id,
        period: 'total',
        periodAmountMicroUsd: 15_000_000,
      }),
    ).rejects.toThrow('INSUFFICIENT_ORG_BALANCE');
  });

  it('sets team model access allow-list', async () => {
    const org = await orgModel.createOrganization({ name: 'Models Org', ownerUserId: ownerId });
    const teams = await orgModel.listTeams(org.id);
    await orgModel.setTeamModelAccess({
      modelIds: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet'],
      orgId: org.id,
      teamId: teams[0].id,
    });
    const rules = await orgModel.getTeamModelAccess(teams[0].id);
    expect(rules.map((r) => r.modelId).sort()).toEqual([
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
    ]);
  });

  it('cannot demote last owner', async () => {
    const org = await orgModel.createOrganization({ name: 'Owner Org', ownerUserId: ownerId });
    const members = await orgModel.listMembers(org.id);
    const ownerMember = members.find((m) => m.role === 'owner')!;

    await expect(
      orgModel.updateMemberRole({ memberId: ownerMember.id, orgId: org.id, role: 'admin' }),
    ).rejects.toThrow('Cannot demote the last owner');
  });
});

describe('AicoBillingModel', () => {
  it('manual credit credits user wallet', async () => {
    const { wallet, transaction } = await billingModel.manualCreditUser({
      amountMicroUsd: 20_000_000,
      amountToman: 100_000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      userId: ownerId,
    });
    expect(transaction.type).toBe('manual_credit');
    expect(wallet.balanceToman).toBe(100_000);
    expect(Number(wallet.balanceMicroUsd)).toBe(20_000_000);
  });

  it('activates trial once per user/phone and blocks abuse fingerprints', async () => {
    await billingModel.updateTrialConfig({
      enabled: true,
      trialBudgetMicroUsd: 1_000_000,
      updatedByUserId: ownerId,
    });

    const trial = await billingModel.activateTrial({
      phone: '+989121234567',
      userId: memberId,
    });
    expect(trial.status).toBe('active');
    expect(trial.phoneFingerprint).toBe(fingerprintPhone('+989121234567'));

    await expect(
      billingModel.activateTrial({ phone: '+989121234567', userId: ownerId }),
    ).rejects.toThrow('TRIAL_PHONE_ALREADY_USED');

    await billingModel.addAbuseBlocklist({ phone: '+989999999999', reason: 'account_delete' });
    await expect(
      billingModel.activateTrial({ phone: '+989999999999', userId: adminId }),
    ).rejects.toThrow('TRIAL_PHONE_BLOCKED');
  });

  it('getTransactionHistory returns org ledger rows inside the date range', async () => {
    const org = await orgModel.createOrganization({ name: 'History Org', ownerUserId: ownerId });
    await orgModel.addManualCredit({
      amountMicroUsd: 10_000_000,
      amountToman: 50_000,
      createdByUserId: ownerId,
      description: 'pilot credit',
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
      type: 'manual_credit',
    });

    const today = new Date().toISOString().slice(0, 10);
    const rows = await orgModel.getTransactionHistory({
      from: today,
      orgId: org.id,
      to: today,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('manual_credit');
    expect(rows[0]?.amountToman).toBe(50_000);
    expect(rows[0]?.amountMicroUsd).toBe(10_000_000);

    const empty = await orgModel.getTransactionHistory({
      from: '2020-01-01',
      orgId: org.id,
      to: '2020-01-02',
    });
    expect(empty).toHaveLength(0);
  });

  it('getOrgUsageChart and getMemberUsageChart bucket usage by UTC day', async () => {
    const org = await orgModel.createOrganization({ name: 'Chart Org', ownerUserId: ownerId });
    const members = await orgModel.listMembers(org.id);
    const ownerMember = members.find((m) => m.userId === ownerId)!;

    await billingModel.recordUsage({
      billingSource: 'organization',
      completionTokens: 20,
      costMicroUsd: 1_500_000,
      modelId: 'openai/gpt-4o',
      orgId: org.id,
      orgMemberId: ownerMember.id,
      promptTokens: 10,
      totalTokens: 30,
      userId: ownerId,
    });

    const day = new Date().toISOString().slice(0, 10);
    const orgChart = await orgModel.getOrgUsageChart({ from: day, orgId: org.id, to: day });
    expect(orgChart).toHaveLength(1);
    expect(orgChart[0]).toMatchObject({
      costMicroUsd: 1_500_000,
      date: day,
      totalTokens: 30,
    });

    const memberChart = await orgModel.getMemberUsageChart({
      from: day,
      orgId: org.id,
      orgMemberId: ownerMember.id,
      to: day,
    });
    expect(memberChart[0]?.costMicroUsd).toBe(1_500_000);

    await expect(
      orgModel.getMemberUsageChart({
        from: day,
        orgId: org.id,
        orgMemberId: 'missing-member',
        to: day,
      }),
    ).rejects.toThrow('MEMBER_NOT_FOUND');
  });
});
