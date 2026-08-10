/**
 * Aico Phase 2 — Invitation security + org lifecycle
 * Maps: AICO-P1-006, AICO-P1-007, AICO-P1-022, AICO-P1-026 + invite matrix
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { OrganizationModel } from '../organization';
import { cleanupAicoTables, seedUsers } from './aico.phase2.helpers';

const serverDB: LobeChatDatabase = await getTestDB();
const orgModel = new OrganizationModel(serverDB);

const ownerId = 'p2-inv-owner';
const memberId = 'p2-inv-member';
const strangerId = 'p2-inv-stranger';
const phoneMemberId = 'p2-inv-phone';

beforeEach(async () => {
  await cleanupAicoTables(serverDB);
  await seedUsers(serverDB, [
    { email: 'inv-owner@example.com', id: ownerId },
    { email: 'inv-member@example.com', id: memberId, phone: '+989123333333' },
    { email: 'inv-stranger@example.com', id: strangerId },
    {
      email: 'inv-phone@example.com',
      id: phoneMemberId,
      phone: '09123333333', // local format — invite stores E.164 via router; model compare is trim-only
      phoneNumberVerified: true,
    },
  ]);
});

afterEach(async () => {
  await cleanupAicoTables(serverDB);
});

describe('Aico invitation security (Phase 2)', () => {
  it('expired token cannot be accepted', async () => {
    const org = await orgModel.createOrganization({ name: 'Inv Org', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'inv-member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });

    // Force expiry
    const { organizationInvites } = await import('../../schemas/aicoOrganization');
    const { eq } = await import('drizzle-orm');
    await serverDB
      .update(organizationInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(organizationInvites.id, invite.id));

    await expect(
      orgModel.acceptInvite({
        email: 'inv-member@example.com',
        token: invite.token,
        userId: memberId,
      }),
    ).rejects.toThrow('INVITE_EXPIRED');
  });

  it('reused token after accept fails', async () => {
    const org = await orgModel.createOrganization({ name: 'Reuse Org', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'inv-member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });

    await orgModel.acceptInvite({
      email: 'inv-member@example.com',
      token: invite.token,
      userId: memberId,
    });

    await expect(
      orgModel.acceptInvite({
        email: 'inv-member@example.com',
        token: invite.token,
        userId: memberId,
      }),
    ).rejects.toThrow(/INVITE_NOT_PENDING|INVITE_/);
  });

  it('malformed / unknown token fails closed', async () => {
    await expect(
      orgModel.acceptInvite({
        email: 'inv-member@example.com',
        token: 'not-a-real-token',
        userId: memberId,
      }),
    ).rejects.toThrow('INVITE_NOT_FOUND');
  });

  it('wrong email cannot accept invite', async () => {
    const org = await orgModel.createOrganization({ name: 'Mismatch Org', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'inv-member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });

    await expect(
      orgModel.acceptInvite({
        email: 'inv-stranger@example.com',
        token: invite.token,
        userId: strangerId,
      }),
    ).rejects.toThrow('INVITE_IDENTIFIER_MISMATCH');
  });

  it('AICO-P1-022: phone invite accept requires matching normalized form', async () => {
    const org = await orgModel.createOrganization({ name: 'Phone Org', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'phone',
      identifierValue: '+989123333333', // E.164 as router would store
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });

    // Local 09… without normalize must not match E.164 invite.
    await expect(
      orgModel.acceptInvite({
        phone: '09123333333',
        token: invite.token,
        userId: phoneMemberId,
      }),
    ).rejects.toThrow(/INVITE_IDENTIFIER_MISMATCH/);

    await expect(
      orgModel.acceptInvite({
        phone: '+989123333333',
        token: invite.token,
        userId: phoneMemberId,
      }),
    ).resolves.toBeTruthy();
  });

  it('revoked invite cannot be accepted', async () => {
    const org = await orgModel.createOrganization({ name: 'Revoke Org', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'inv-member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });
    await orgModel.revokeInvite({ inviteId: invite.id, orgId: org.id });

    await expect(
      orgModel.acceptInvite({
        email: 'inv-member@example.com',
        token: invite.token,
        userId: memberId,
      }),
    ).rejects.toThrow(/INVITE_NOT_PENDING/);
  });

  it('AICO-P1-026: createInvite returns raw token (secret exposure surface)', async () => {
    const org = await orgModel.createOrganization({ name: 'Token Org', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'inv-member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });
    expect(invite.token).toBeTruthy();
    expect(invite.token.length).toBeGreaterThan(10);

    const pending = await orgModel.listPendingInvites(org.id);
    // list endpoints exposing raw tokens widen leak surface
    expect(pending[0]?.token).toBe(invite.token);
  });

  it('acceptance after organization suspend — invite create blocked at router; model still accepts pending', async () => {
    const org = await orgModel.createOrganization({ name: 'Suspend Inv', ownerUserId: ownerId });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'inv-member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });
    await orgModel.setOrganizationStatus(org.id, 'suspended');

    // Invariant: accepting into suspended org should fail.
    await expect(
      orgModel.acceptInvite({
        email: 'inv-member@example.com',
        token: invite.token,
        userId: memberId,
      }),
    ).rejects.toThrow(/SUSPENDED|FORBIDDEN|INVITE_|ORG_NOT_ACTIVE/);
  });
});

describe('Aico organization lifecycle (Phase 2)', () => {
  it('AICO-P1-006: suspended org still listed for member and allocate still works (non-enforcing)', async () => {
    const org = await orgModel.createOrganization({ name: 'Life Org', ownerUserId: ownerId });
    await orgModel.addManualCredit({
      amountToman: 50_000,
      amountMicroUsd: 10000000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'inv-member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });
    const { member } = await orgModel.acceptInvite({
      email: 'inv-member@example.com',
      token: invite.token,
      userId: memberId,
    });

    await orgModel.setOrganizationStatus(org.id, 'suspended');

    const listed = await orgModel.listForUser(memberId);
    // Invariant: suspended orgs must not appear as spendable context.
    expect(listed.find((o) => o.id === org.id)).toBeUndefined();

    await expect(
      orgModel.allocateMemberCredit({
        periodAmountMicroUsd: 1000000,
        period: 'total',
        createdByUserId: ownerId,
        orgId: org.id,
        orgMemberId: member.id,
      }),
    ).rejects.toThrow(/SUSPENDED|FORBIDDEN|INSUFFICIENT|ORG_NOT_ACTIVE/);
  });

  it('AICO-P1-007: removeMember only soft-disables; budget key fields remain', async () => {
    const org = await orgModel.createOrganization({ name: 'Remove Org', ownerUserId: ownerId });
    await orgModel.addManualCredit({
      amountToman: 50_000,
      amountMicroUsd: 10000000,
      createdByUserId: ownerId,
      fxRateTomanPerUsd: 5000,
      orgId: org.id,
    });
    const invite = await orgModel.createInvite({
      identifierType: 'email',
      identifierValue: 'inv-member@example.com',
      invitedByUserId: ownerId,
      orgId: org.id,
      role: 'member',
    });
    const { member } = await orgModel.acceptInvite({
      email: 'inv-member@example.com',
      token: invite.token,
      userId: memberId,
    });
    await orgModel.allocateMemberCredit({
      periodAmountMicroUsd: 5000000,
      period: 'total',
      createdByUserId: ownerId,
      orgId: org.id,
      orgMemberId: member.id,
    });
    await orgModel.updateMemberOpenRouterKey({
      ciphertext: 'cipher:fake',
      keyId: 'or-key-alive',
      orgMemberId: member.id,
    });

    const removed = await orgModel.removeMember({ memberId: member.id, orgId: org.id });
    expect(removed?.status).toBe('revocation_pending');

    const budget = await orgModel.getMemberBudget(member.id);
    // Key material stays until outbox reclaim settles (AICO-105 reclaim path).
    expect(budget?.openrouterKeyId).toBe('or-key-alive');
  });

  it('cannot delete default team', async () => {
    const org = await orgModel.createOrganization({ name: 'Team Org', ownerUserId: ownerId });
    const teams = await orgModel.listTeams(org.id);
    const def = teams.find((t) => t.isDefault)!;
    await expect(orgModel.deleteTeam({ orgId: org.id, teamId: def.id })).rejects.toThrow(
      'CANNOT_DELETE_DEFAULT_TEAM',
    );
  });

  it('cannot demote last owner', async () => {
    const org = await orgModel.createOrganization({ name: 'Owner Org', ownerUserId: ownerId });
    const members = await orgModel.listMembers(org.id);
    const ownerMember = members.find((m) => m.role === 'owner')!;
    await expect(
      orgModel.updateMemberRole({ memberId: ownerMember.id, orgId: org.id, role: 'admin' }),
    ).rejects.toThrow(/last owner/i);
  });
});
