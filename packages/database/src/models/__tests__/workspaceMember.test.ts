import { INVITATION_EXPIRY_DAYS } from '@lobechat/const';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaceInvitations, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { WorkspaceMemberModel } from '../workspaceMember';

const serverDB: LobeChatDatabase = await getTestDB();

const inviterId = 'wm-inviter';
const memberId = 'wm-member';
const otherUserId = 'wm-other-user';
const workspaceId = 'wm-workspace';
const otherWorkspaceId = 'wm-other-workspace';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: inviterId }, { id: memberId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'WS', primaryOwnerId: inviterId, slug: 'ws' },
    { id: otherWorkspaceId, name: 'Other WS', primaryOwnerId: otherUserId, slug: 'other-ws' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('WorkspaceMemberModel', () => {
  describe('addMember', () => {
    it('adds a member with the default role when none is provided', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      const result = await model.addMember({ userId: memberId, workspaceId });

      expect(result.workspaceId).toBe(workspaceId);
      expect(result.userId).toBe(memberId);
      expect(result.role).toBe('member');
      expect(result.deletedAt).toBeNull();
    });

    it('adds a member with an explicit role', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      const result = await model.addMember({ role: 'owner', userId: memberId, workspaceId });

      expect(result.role).toBe('owner');
    });

    it('upserts the role and revives a soft-deleted member on conflict', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      await model.addMember({ role: 'member', userId: memberId, workspaceId });
      await model.removeMember(workspaceId, memberId);

      // soft-deleted now; re-adding should revive and update the role
      const revived = await model.addMember({ role: 'owner', userId: memberId, workspaceId });

      expect(revived.role).toBe('owner');
      expect(revived.deletedAt).toBeNull();

      // composite PK guarantees a single row per (workspace, user)
      const rows = await serverDB
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId));
      expect(rows).toHaveLength(1);
    });

    it('falls back to the default role when reviving without an explicit role', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      await model.addMember({ role: 'owner', userId: memberId, workspaceId });
      const revived = await model.addMember({ userId: memberId, workspaceId });

      expect(revived.role).toBe('member');
    });
  });

  describe('getMember', () => {
    it('returns the active member', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ role: 'viewer', userId: memberId, workspaceId });

      const found = await model.getMember(workspaceId, memberId);

      expect(found?.userId).toBe(memberId);
      expect(found?.role).toBe('viewer');
    });

    it('returns undefined for a soft-deleted member', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ userId: memberId, workspaceId });
      await model.removeMember(workspaceId, memberId);

      expect(await model.getMember(workspaceId, memberId)).toBeUndefined();
    });

    it('returns undefined when the member does not exist', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      expect(await model.getMember(workspaceId, 'nobody')).toBeUndefined();
    });

    it('isolates members across workspaces', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ userId: memberId, workspaceId });

      expect(await model.getMember(otherWorkspaceId, memberId)).toBeUndefined();
    });
  });

  describe('listMembers', () => {
    it('lists only active members by default', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ userId: inviterId, workspaceId });
      await model.addMember({ userId: memberId, workspaceId });
      await model.removeMember(workspaceId, memberId);

      const rows = await model.listMembers(workspaceId);

      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(inviterId);
    });

    it('includes soft-deleted members when includeDeleted is true', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ userId: inviterId, workspaceId });
      await model.addMember({ userId: memberId, workspaceId });
      await model.removeMember(workspaceId, memberId);

      const rows = await model.listMembers(workspaceId, { includeDeleted: true });

      expect(rows.map((r) => r.userId).sort()).toEqual([inviterId, memberId].sort());
    });

    it('does not leak members from other workspaces', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ userId: memberId, workspaceId });
      await model.addMember({ userId: otherUserId, workspaceId: otherWorkspaceId });

      const rows = await model.listMembers(workspaceId);

      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(memberId);
    });

    it('returns an empty list for a workspace with no members', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      expect(await model.listMembers(workspaceId)).toEqual([]);
    });
  });

  describe('removeMember', () => {
    it('soft-deletes an active member', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ userId: memberId, workspaceId });

      await model.removeMember(workspaceId, memberId);

      const [row] = await serverDB
        .select()
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)),
        );
      expect(row.deletedAt).not.toBeNull();
    });

    it('does not touch members of other workspaces', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ userId: otherUserId, workspaceId: otherWorkspaceId });

      await model.removeMember(workspaceId, otherUserId);

      const [row] = await serverDB
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, otherWorkspaceId));
      expect(row.deletedAt).toBeNull();
    });
  });

  describe('updateMemberRole', () => {
    it('updates the role of an active member', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ role: 'member', userId: memberId, workspaceId });

      await model.updateMemberRole(workspaceId, memberId, 'owner');

      const found = await model.getMember(workspaceId, memberId);
      expect(found?.role).toBe('owner');
    });

    it('does not update the role of a soft-deleted member', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.addMember({ role: 'member', userId: memberId, workspaceId });
      await model.removeMember(workspaceId, memberId);

      await model.updateMemberRole(workspaceId, memberId, 'owner');

      const [row] = await serverDB
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, memberId));
      expect(row.role).toBe('member');
    });
  });

  describe('createInvitation', () => {
    it('creates an invitation with the default role and a pending status', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      const result = await model.createInvitation({ email: 'a@b.com', workspaceId });

      expect(result.workspaceId).toBe(workspaceId);
      expect(result.inviterId).toBe(inviterId);
      expect(result.email).toBe('a@b.com');
      expect(result.role).toBe('member');
      expect(result.status).toBe('pending');
      expect(result.token).toHaveLength(32);
    });

    it('creates an invitation with an explicit role and an expiry INVITATION_EXPIRY_DAYS out', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      const before = Date.now();

      const result = await model.createInvitation({ role: 'owner', workspaceId });

      expect(result.role).toBe('owner');
      expect(result.email).toBeNull();
      const expectedMs = INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      const diff = result.expiresAt.getTime() - before;
      // allow generous slack for test execution time
      expect(diff).toBeGreaterThan(expectedMs - 60_000);
      expect(diff).toBeLessThan(expectedMs + 60_000);
    });

    it('generates a unique token per invitation', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      const a = await model.createInvitation({ workspaceId });
      const b = await model.createInvitation({ workspaceId });

      expect(a.token).not.toBe(b.token);
    });
  });

  describe('findInvitationByToken', () => {
    it('finds an invitation by its token', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      const created = await model.createInvitation({ workspaceId });

      const found = await model.findInvitationByToken(created.token);

      expect(found?.id).toBe(created.id);
    });

    it('returns undefined for an unknown token', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      expect(await model.findInvitationByToken('does-not-exist')).toBeUndefined();
    });
  });

  describe('listPendingInvitations', () => {
    it('lists only pending invitations for the workspace', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      const pending = await model.createInvitation({ workspaceId });
      const accepted = await model.createInvitation({ workspaceId });
      await model.updateInvitationStatus(accepted.id, 'accepted');

      const rows = await model.listPendingInvitations(workspaceId);

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(pending.id);
    });

    it('does not include invitations from other workspaces', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      await model.createInvitation({ workspaceId });
      const otherModel = new WorkspaceMemberModel(serverDB, otherUserId);
      await otherModel.createInvitation({ workspaceId: otherWorkspaceId });

      const rows = await model.listPendingInvitations(workspaceId);

      expect(rows).toHaveLength(1);
      expect(rows[0].workspaceId).toBe(workspaceId);
    });

    it('returns an empty list when there are no pending invitations', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);

      expect(await model.listPendingInvitations(workspaceId)).toEqual([]);
    });
  });

  describe('revokeInvitation', () => {
    it('sets the invitation status to revoked', async () => {
      const model = new WorkspaceMemberModel(serverDB, inviterId);
      const created = await model.createInvitation({ workspaceId });

      await model.revokeInvitation(created.id);

      const [row] = await serverDB
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, created.id));
      expect(row.status).toBe('revoked');
    });
  });

  describe('updateInvitationStatus', () => {
    it.each(['accepted', 'expired', 'revoked'] as const)(
      'updates the invitation status to %s',
      async (status) => {
        const model = new WorkspaceMemberModel(serverDB, inviterId);
        const created = await model.createInvitation({ workspaceId });

        await model.updateInvitationStatus(created.id, status);

        const found = await model.findInvitationByToken(created.token);
        expect(found?.status).toBe(status);
      },
    );
  });
});
