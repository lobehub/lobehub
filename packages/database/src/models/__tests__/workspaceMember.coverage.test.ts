// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { WorkspaceMemberModel } from '../workspaceMember';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'wm-coverage-owner';
const memberId = 'wm-coverage-member';
const leftId = 'wm-coverage-left';
const userIds = [ownerId, memberId, leftId];
const workspaceId = 'wm-coverage-ws';

beforeEach(async () => {
  // The workspace and its memberships cascade from the owning user.
  await serverDB.delete(users).where(inArray(users.id, userIds));
  await serverDB.insert(users).values(userIds.map((id) => ({ id })));
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: ownerId, slug: workspaceId });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
    { deletedAt: new Date(), role: 'member', userId: leftId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, userIds));
});

describe('WorkspaceMemberModel coverage', () => {
  it('getMemberForUpdate returns the active membership and nothing for a removed member', async () => {
    const model = new WorkspaceMemberModel(serverDB, ownerId);

    const locked = await serverDB.transaction(async (tx) => {
      const txModel = new WorkspaceMemberModel(tx as unknown as LobeChatDatabase, ownerId);
      return {
        active: await txModel.getMemberForUpdate(workspaceId, memberId),
        removed: await txModel.getMemberForUpdate(workspaceId, leftId),
      };
    });

    expect(locked.active).toMatchObject({ role: 'member', userId: memberId, workspaceId });
    expect(locked.removed).toBeUndefined();
    expect(await model.getMemberForUpdate(workspaceId, 'wm-coverage-nobody')).toBeUndefined();
  });

  it('listMembers includes soft-deleted members only when asked', async () => {
    const model = new WorkspaceMemberModel(serverDB, ownerId);

    const active = await model.listMembers(workspaceId);
    const all = await model.listMembers(workspaceId, { includeDeleted: true });

    expect(active.map((m) => m.userId).sort()).toEqual([memberId, ownerId].sort());
    expect(all.map((m) => m.userId).sort()).toEqual([leftId, memberId, ownerId].sort());
  });

  it('searchAssignableMembers short-circuits a non-positive limit', async () => {
    const model = new WorkspaceMemberModel(serverDB, ownerId);

    expect(await model.searchAssignableMembers(workspaceId, { limit: 0 })).toEqual({
      rows: [],
      total: 0,
    });

    // The membership rows themselves are untouched.
    const [row] = await serverDB
      .select()
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)),
      );
    expect(row.role).toBe('member');
  });
});
