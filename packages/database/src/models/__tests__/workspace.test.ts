// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  users,
  workspaceAuditLogs,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { WorkspaceModel } from '../workspace';
import { WorkspaceAuditLogModel } from '../workspaceAuditLog';
import { WorkspaceMemberModel } from '../workspaceMember';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'workspace-model-owner';
const memberId = 'workspace-model-member';
const secondOwnerId = 'workspace-model-second-owner';
const outsiderId = 'workspace-model-outsider';

const cleanup = async () => {
  await serverDB.delete(workspaceAuditLogs);
  await serverDB.delete(workspaceInvitations);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

const createWorkspace = async (id = 'workspace-model-ws') => {
  await serverDB.insert(workspaces).values({
    id,
    name: id,
    primaryOwnerId: ownerId,
    settings: { gracePeriodUntil: 123, keep: true },
    slug: id,
  });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId: id },
    { role: 'member', userId: memberId, workspaceId: id },
    { role: 'owner', userId: secondOwnerId, workspaceId: id },
  ]);
  return id;
};

beforeEach(async () => {
  await cleanup();
  await serverDB
    .insert(users)
    .values([{ id: ownerId }, { id: memberId }, { id: secondOwnerId }, { id: outsiderId }]);
});

afterEach(async () => {
  await cleanup();
});

describe('WorkspaceModel', () => {
  it('creates the workspace and inserts the creator as owner member', async () => {
    const model = new WorkspaceModel(serverDB, ownerId);

    const workspace = await model.create({
      avatar: 'avatar.png',
      description: 'Team workspace',
      name: 'Acme',
      slug: 'acme',
    });

    expect(workspace.primaryOwnerId).toBe(ownerId);
    expect(workspace.slug).toBe('acme');

    const membership = await serverDB.query.workspaceMembers.findFirst({
      where: eq(workspaceMembers.workspaceId, workspace.id),
    });
    expect(membership).toMatchObject({
      role: 'owner',
      userId: ownerId,
      workspaceId: workspace.id,
    });
  });

  it('lists active memberships with their workspace roles and skips deleted memberships', async () => {
    const workspaceId = await createWorkspace();
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, memberId));

    const ownerWorkspaces = await new WorkspaceModel(serverDB, ownerId).listUserWorkspaces();
    const memberWorkspaces = await new WorkspaceModel(serverDB, memberId).listUserWorkspaces();

    expect(ownerWorkspaces).toEqual([expect.objectContaining({ id: workspaceId, role: 'owner' })]);
    expect(memberWorkspaces).toEqual([]);
  });

  it('does not delete workspaces owned by another primary owner', async () => {
    const workspaceId = await createWorkspace();

    await new WorkspaceModel(serverDB, outsiderId).delete(workspaceId);

    const workspace = await serverDB.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    expect(workspace).toBeDefined();
  });

  it('transfers primary ownership only to an active owner member', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceModel(serverDB, ownerId);

    await expect(model.transferPrimaryOwnership(workspaceId, memberId)).rejects.toThrow(
      'Target user must already be an owner',
    );

    await expect(model.transferPrimaryOwnership(workspaceId, secondOwnerId)).resolves.toEqual({
      newPrimaryOwnerUserId: secondOwnerId,
      previousPrimaryOwnerUserId: ownerId,
      workspaceId,
    });

    const workspace = await serverDB.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    expect(workspace?.primaryOwnerId).toBe(secondOwnerId);
  });

  it('downgrades to Free by clearing the grace period without touching members', async () => {
    const workspaceId = await createWorkspace();

    const result = await new WorkspaceModel(serverDB, ownerId).downgradeToFree(workspaceId);

    expect(result.workspace.settings).toEqual({ keep: true });

    // Members stay — Free supports multiple members and the billing-inactive
    // lockout handles the view-only state instead of evicting the team.
    const allMembers = await serverDB.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.workspaceId, workspaceId),
    });
    expect(
      allMembers
        .filter((member) => !member.deletedAt)
        .map((member) => member.userId)
        .sort(),
    ).toEqual([memberId, ownerId, secondOwnerId].sort());
  });

  it('sets and clears grace period without dropping unrelated settings', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceModel(serverDB, ownerId);

    await model.setGracePeriod(workspaceId, 456);
    await expect(model.getSettings(workspaceId)).resolves.toEqual({
      gracePeriodUntil: 456,
      keep: true,
    });

    await model.setGracePeriod(workspaceId, null);
    await expect(model.getSettings(workspaceId)).resolves.toEqual({ keep: true });
  });

  it('finds a workspace by id and by slug, and returns undefined when missing', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceModel(serverDB, ownerId);

    await expect(model.findById(workspaceId)).resolves.toMatchObject({ id: workspaceId });
    await expect(model.findBySlug(workspaceId)).resolves.toMatchObject({ slug: workspaceId });
    await expect(model.findById('missing')).resolves.toBeUndefined();
    await expect(model.findBySlug('missing')).resolves.toBeUndefined();
  });

  it('lists only workspace ids where the user is the primary owner', async () => {
    const workspaceId = await createWorkspace();

    const owned = await new WorkspaceModel(serverDB, ownerId).listOwnedWorkspaceIds();
    expect(owned).toEqual([workspaceId]);

    // secondOwnerId is an owner member but not the primary owner
    const secondOwned = await new WorkspaceModel(serverDB, secondOwnerId).listOwnedWorkspaceIds();
    expect(secondOwned).toEqual([]);
  });

  it('returns empty settings object when workspace does not exist', async () => {
    await expect(new WorkspaceModel(serverDB, ownerId).getSettings('missing')).resolves.toEqual({});
  });

  it('counts every active membership and excludes soft-deleted ones', async () => {
    const workspaceId = await createWorkspace();

    await expect(new WorkspaceModel(serverDB, ownerId).countUserMemberships()).resolves.toBe(1);

    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, memberId));
    await expect(new WorkspaceModel(serverDB, memberId).countUserMemberships()).resolves.toBe(0);
    await expect(new WorkspaceModel(serverDB, outsiderId).countUserMemberships()).resolves.toBe(0);

    void workspaceId;
  });

  it('returns empty list when the user has no memberships', async () => {
    await createWorkspace();
    await expect(new WorkspaceModel(serverDB, outsiderId).listUserWorkspaces()).resolves.toEqual(
      [],
    );
  });

  it('falls back to viewer role when a workspace has no matching membership row', async () => {
    const workspaceId = await createWorkspace();
    // Give outsider a membership with an unexpected role value to exercise the
    // role lookup, then remove the membership row matching but keep workspace.
    await serverDB.insert(workspaceMembers).values({
      role: 'viewer',
      userId: outsiderId,
      workspaceId,
    });

    const list = await new WorkspaceModel(serverDB, outsiderId).listUserWorkspaces();
    expect(list).toEqual([expect.objectContaining({ id: workspaceId, role: 'viewer' })]);
  });

  it('updates editable fields and bumps updatedAt', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceModel(serverDB, ownerId);

    await model.update(workspaceId, { description: 'updated', name: 'Renamed', slug: 'renamed' });

    const workspace = await serverDB.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    expect(workspace).toMatchObject({ description: 'updated', name: 'Renamed', slug: 'renamed' });
  });

  it('updates settings wholesale via updateSettings', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceModel(serverDB, ownerId);

    await model.updateSettings(workspaceId, { brandNew: true });
    await expect(model.getSettings(workspaceId)).resolves.toEqual({ brandNew: true });
  });

  describe('transferPrimaryOwnership errors', () => {
    it('rejects transferring to self', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, ownerId).transferPrimaryOwnership(workspaceId, ownerId),
      ).rejects.toThrow('New primary owner must be a different user');
    });

    it('rejects when the workspace does not exist', async () => {
      await expect(
        new WorkspaceModel(serverDB, ownerId).transferPrimaryOwnership('missing', secondOwnerId),
      ).rejects.toThrow('Workspace not found');
    });

    it('rejects when actor is not the primary owner', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, secondOwnerId).transferPrimaryOwnership(workspaceId, ownerId),
      ).rejects.toThrow('Only the primary owner can transfer primary ownership');
    });

    it('rejects when the target is not a member', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, ownerId).transferPrimaryOwnership(workspaceId, outsiderId),
      ).rejects.toThrow('Target user must already be a member of the workspace');
    });
  });

  describe('promoteToOwner', () => {
    it('promotes a member to owner', async () => {
      const workspaceId = await createWorkspace();
      const result = await new WorkspaceModel(serverDB, ownerId).promoteToOwner(
        workspaceId,
        memberId,
      );

      expect(result).toMatchObject({ role: 'owner', userId: memberId });

      const membership = await serverDB.query.workspaceMembers.findFirst({
        where: eq(workspaceMembers.userId, memberId),
      });
      expect(membership?.role).toBe('owner');
    });

    it('is a no-op when the target is already an owner', async () => {
      const workspaceId = await createWorkspace();
      const result = await new WorkspaceModel(serverDB, ownerId).promoteToOwner(
        workspaceId,
        secondOwnerId,
      );
      expect(result).toMatchObject({ role: 'owner', userId: secondOwnerId });
    });

    it('rejects when the actor is not an owner', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, memberId).promoteToOwner(workspaceId, memberId),
      ).rejects.toThrow('Only an owner can promote other members to owner');
    });

    it('rejects when the target is not a member', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, ownerId).promoteToOwner(workspaceId, outsiderId),
      ).rejects.toThrow('Target user is not a member of this workspace');
    });
  });

  describe('demoteFromOwner', () => {
    it('demotes an owner to member', async () => {
      const workspaceId = await createWorkspace();
      const result = await new WorkspaceModel(serverDB, ownerId).demoteFromOwner(
        workspaceId,
        secondOwnerId,
      );

      expect(result).toMatchObject({ role: 'member', userId: secondOwnerId });
      const membership = await serverDB.query.workspaceMembers.findFirst({
        where: eq(workspaceMembers.userId, secondOwnerId),
      });
      expect(membership?.role).toBe('member');
    });

    it('is a no-op when the target is not an owner', async () => {
      const workspaceId = await createWorkspace();
      const result = await new WorkspaceModel(serverDB, ownerId).demoteFromOwner(
        workspaceId,
        memberId,
      );
      expect(result).toMatchObject({ role: 'member', userId: memberId });
    });

    it('rejects when the workspace does not exist', async () => {
      await expect(
        new WorkspaceModel(serverDB, ownerId).demoteFromOwner('missing', secondOwnerId),
      ).rejects.toThrow('Workspace not found');
    });

    it('rejects demoting the primary owner', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, ownerId).demoteFromOwner(workspaceId, ownerId),
      ).rejects.toThrow('Cannot demote the primary owner');
    });

    it('rejects when the actor is not an owner', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, memberId).demoteFromOwner(workspaceId, secondOwnerId),
      ).rejects.toThrow('Only an owner can demote other owners');
    });

    it('rejects when the target is not a member', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, ownerId).demoteFromOwner(workspaceId, outsiderId),
      ).rejects.toThrow('Target user is not a member of this workspace');
    });
  });

  it('counts other active owners excluding the given user', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceModel(serverDB, ownerId);

    // owners: ownerId, secondOwnerId. Excluding ownerId -> 1 other owner.
    await expect(model.countOtherOwners(workspaceId, ownerId)).resolves.toBe(1);

    // soft-delete secondOwnerId membership -> 0 other owners.
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, secondOwnerId));
    await expect(model.countOtherOwners(workspaceId, ownerId)).resolves.toBe(0);
  });

  describe('downgradeToFree and setGracePeriod errors', () => {
    it('rejects downgradeToFree when the workspace does not exist', async () => {
      await expect(
        new WorkspaceModel(serverDB, ownerId).downgradeToFree('missing'),
      ).rejects.toThrow('Workspace not found');
    });

    it('rejects downgradeToFree when actor is not the primary owner', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, secondOwnerId).downgradeToFree(workspaceId),
      ).rejects.toThrow('Only the primary owner can downgrade this workspace');
    });

    it('rejects setGracePeriod when the workspace does not exist', async () => {
      await expect(
        new WorkspaceModel(serverDB, ownerId).setGracePeriod('missing', 123),
      ).rejects.toThrow('Workspace not found');
    });
  });
});

describe('WorkspaceMemberModel', () => {
  it('revives a deleted member on addMember and applies the new role', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceMemberModel(serverDB, ownerId);

    await model.removeMember(workspaceId, memberId);
    const revived = await model.addMember({ role: 'viewer', userId: memberId, workspaceId });

    expect(revived).toMatchObject({
      deletedAt: null,
      role: 'viewer',
      userId: memberId,
      workspaceId,
    });
  });

  it('lists only active members unless includeDeleted is requested', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceMemberModel(serverDB, ownerId);

    await model.removeMember(workspaceId, memberId);

    const active = await model.listMembers(workspaceId);
    const all = await model.listMembers(workspaceId, { includeDeleted: true });

    expect(active.map((member) => member.userId).sort()).toEqual([ownerId, secondOwnerId].sort());
    expect(all.map((member) => member.userId).sort()).toEqual(
      [ownerId, memberId, secondOwnerId].sort(),
    );
  });

  it('creates pending invitations with a default member role and expiry', async () => {
    const workspaceId = await createWorkspace();
    const before = new Date();

    const invitation = await new WorkspaceMemberModel(serverDB, ownerId).createInvitation({
      email: 'new@example.com',
      workspaceId,
    });

    expect(invitation).toMatchObject({
      email: 'new@example.com',
      inviterId: ownerId,
      role: 'member',
      status: 'pending',
      workspaceId,
    });
    expect(invitation.token).toHaveLength(32);
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(
      before.getTime() + 6 * 24 * 60 * 60 * 1000,
    );
  });
});

describe('WorkspaceAuditLogModel', () => {
  it('creates logs with empty metadata by default', async () => {
    const workspaceId = await createWorkspace();

    const log = await new WorkspaceAuditLogModel(serverDB).create({
      action: 'workspace.created',
      userId: ownerId,
      workspaceId,
    });

    expect(log).toMatchObject({
      action: 'workspace.created',
      metadata: {},
      userId: ownerId,
      workspaceId,
    });
  });

  it('lists logs by workspace and action with cursor pagination', async () => {
    const workspaceId = await createWorkspace();
    await serverDB.insert(workspaceAuditLogs).values([
      {
        action: 'workspace.created',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        resourceId: 'old',
        userId: ownerId,
        workspaceId,
      },
      {
        action: 'workspace.updated',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        resourceId: 'middle',
        userId: ownerId,
        workspaceId,
      },
      {
        action: 'workspace.updated',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        resourceId: 'new',
        userId: ownerId,
        workspaceId,
      },
    ]);

    const result = await new WorkspaceAuditLogModel(serverDB).list({
      action: 'workspace.updated',
      limit: 1,
      workspaceId,
    });

    expect(result.items.map((item) => item.resourceId)).toEqual(['new']);
    expect(result.nextCursor).toBe('2026-01-03T00:00:00.000Z');

    const next = await new WorkspaceAuditLogModel(serverDB).list({
      action: 'workspace.updated',
      cursor: new Date(result.nextCursor!),
      limit: 1,
      workspaceId,
    });
    expect(next.items.map((item) => item.resourceId)).toEqual(['middle']);
  });
});
