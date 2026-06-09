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

  it('downgrades to solo by removing non-primary members and clearing grace period', async () => {
    const workspaceId = await createWorkspace();

    const result = await new WorkspaceModel(serverDB, ownerId).downgradeToSolo(workspaceId);

    expect(result.removedUserIds.sort()).toEqual([memberId, secondOwnerId].sort());
    expect(result.workspace.settings).toEqual({ keep: true });

    const activeMembers = await serverDB.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.workspaceId, workspaceId),
    });
    expect(activeMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deletedAt: null, userId: ownerId }),
        expect.objectContaining({ userId: memberId }),
        expect.objectContaining({ userId: secondOwnerId }),
      ]),
    );
    expect(
      activeMembers.filter((member) => !member.deletedAt).map((member) => member.userId),
    ).toEqual([ownerId]);
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
