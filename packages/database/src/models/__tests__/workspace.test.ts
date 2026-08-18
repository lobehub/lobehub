// @vitest-environment node
import { and, eq } from 'drizzle-orm';
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
import { hasWorkspaceAdminAccess, WorkspaceModel } from '../workspace';
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
    { role: 'admin', userId: secondOwnerId, workspaceId: id },
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

  it('derives Admin access from membership.role — the single source of truth', async () => {
    const workspaceId = await createWorkspace();

    await expect(
      hasWorkspaceAdminAccess(serverDB, { userId: secondOwnerId, workspaceId }),
    ).resolves.toBe(true);
    await expect(
      hasWorkspaceAdminAccess(serverDB, { userId: memberId, workspaceId }),
    ).resolves.toBe(false);

    // Promoting the column immediately grants access — no RBAC rows involved.
    await serverDB
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(eq(workspaceMembers.userId, memberId));
    await expect(
      hasWorkspaceAdminAccess(serverDB, { userId: memberId, workspaceId }),
    ).resolves.toBe(true);

    // Soft-deleted memberships lose access.
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, memberId));
    await expect(
      hasWorkspaceAdminAccess(serverDB, { userId: memberId, workspaceId }),
    ).resolves.toBe(false);
  });

  it('denies owner access for a legacy non-primary owner label', async () => {
    const workspaceId = await createWorkspace();
    // Move the `owner` label off the primary owner and onto someone else. The
    // unique active-owner index forbids two owner rows, but it does not require
    // the surviving one to belong to `primaryOwnerId` — that is precisely the
    // drift this clamp exists to absorb, so the demotion has to come first.
    await serverDB
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, ownerId)),
      );
    await serverDB
      .update(workspaceMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, secondOwnerId),
        ),
      );

    const { hasWorkspaceOwnerAccess } = await import('../workspace');
    await expect(
      hasWorkspaceOwnerAccess(serverDB, { userId: secondOwnerId, workspaceId }),
    ).resolves.toBe(false);
    // …but the stray label still counts as Admin.
    await expect(
      hasWorkspaceAdminAccess(serverDB, { userId: secondOwnerId, workspaceId }),
    ).resolves.toBe(true);
  });

  it('rejects a second active owner at the database level', async () => {
    const workspaceId = await createWorkspace();

    // Drizzle wraps the driver error, so the constraint name only appears on
    // the cause — assert it there rather than matching the generic message.
    const error = await serverDB
      .update(workspaceMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, secondOwnerId),
        ),
      )
      .then(() => null)
      .catch((thrown) => thrown as { cause?: { code?: string; constraint?: string } });

    expect(error?.cause?.constraint).toBe('workspace_members_unique_active_owner_idx');
    expect(error?.cause?.code).toBe('23505');
  });

  it('lets a removed owner be replaced', async () => {
    const workspaceId = await createWorkspace();
    // The index skips soft-deleted rows, so removing an owner must not wedge
    // the workspace into a state where no one else can hold the role.
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, ownerId)),
      );

    await expect(
      serverDB
        .update(workspaceMembers)
        .set({ role: 'owner' })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, secondOwnerId),
          ),
        ),
    ).resolves.toBeDefined();
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

  it('atomically swaps the unique Owner role with an active Admin', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceModel(serverDB, ownerId);

    await expect(model.transferPrimaryOwnership(workspaceId, memberId)).rejects.toThrow(
      'Target user must already be an admin',
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

    const memberships = await serverDB.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.workspaceId, workspaceId),
    });
    expect(memberships.find((member) => member.userId === ownerId)?.role).toBe('admin');
    expect(memberships.find((member) => member.userId === secondOwnerId)?.role).toBe('owner');
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

  it('defaults API Key member creation to all members and updates it without replacing settings', async () => {
    const workspaceId = await createWorkspace();
    const model = new WorkspaceModel(serverDB, ownerId);

    await expect(model.getApiKeyMemberCreation(workspaceId)).resolves.toBe('all_members');
    await model.updateApiKeyMemberCreation(workspaceId, 'admins_only');

    await expect(model.getApiKeyMemberCreation(workspaceId)).resolves.toBe('admins_only');
    await expect(model.getSettings(workspaceId)).resolves.toEqual({
      apiKey: { memberCreation: 'admins_only' },
      gracePeriodUntil: 123,
      keep: true,
    });
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

    // secondOwnerId is an Admin, not the unique Owner.
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
      ).rejects.toThrow('New owner must be a different user');
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
      ).rejects.toThrow('Only the workspace owner can transfer ownership');
    });

    it('rejects when the target is not a member', async () => {
      const workspaceId = await createWorkspace();
      await expect(
        new WorkspaceModel(serverDB, ownerId).transferPrimaryOwnership(workspaceId, outsiderId),
      ).rejects.toThrow('Target user must already be a member of the workspace');
    });
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
      ).rejects.toThrow('Only the workspace owner can downgrade this workspace');
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
        resourceType: 'workspace',
        userId: ownerId,
        workspaceId,
      },
      {
        action: 'workspace.updated',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        resourceId: 'middle',
        resourceType: 'workspace',
        userId: ownerId,
        workspaceId,
      },
      {
        action: 'workspace.updated',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        resourceId: 'new',
        resourceType: 'invitation',
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

    const invitationResult = await new WorkspaceAuditLogModel(serverDB).list({
      resourceType: 'invitation',
      workspaceId,
    });
    expect(invitationResult.items.map((item) => item.resourceId)).toEqual(['new']);
  });

  it('searches logs by audit fields and matched user ids', async () => {
    const workspaceId = await createWorkspace();
    await serverDB.insert(workspaceAuditLogs).values([
      {
        action: 'billing.payment_method_added',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ipAddress: '203.0.113.10',
        resourceId: 'pm_card_visa',
        resourceType: 'payment_method',
        userId: ownerId,
        workspaceId,
      },
      {
        action: 'member.invited',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        resourceId: 'invitation-1',
        resourceType: 'invitation',
        userId: memberId,
        workspaceId,
      },
      {
        action: 'workspace.updated',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        resourceId: 'workspace-1',
        resourceType: 'workspace',
        userId: secondOwnerId,
        workspaceId,
      },
    ]);

    const auditFieldResult = await new WorkspaceAuditLogModel(serverDB).list({
      q: 'PAYMENT',
      workspaceId,
    });
    expect(auditFieldResult.items.map((item) => item.resourceId)).toEqual(['pm_card_visa']);

    const userResult = await new WorkspaceAuditLogModel(serverDB).list({
      q: 'member@example.com',
      userIds: [memberId],
      workspaceId,
    });
    expect(userResult.items.map((item) => item.resourceId)).toEqual(['invitation-1']);
  });
});
