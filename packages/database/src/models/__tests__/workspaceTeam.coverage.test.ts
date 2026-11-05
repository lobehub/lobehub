// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { WorkspaceTeamModel } from '../workspaceTeam';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'wt-coverage-owner';
const otherOwnerId = 'wt-coverage-other-owner';
const userIds = [ownerId, otherOwnerId];
const workspaceId = 'wt-coverage-ws';
const otherWorkspaceId = 'wt-coverage-other-ws';

beforeEach(async () => {
  // Workspaces, memberships and teams cascade from their owning users.
  await serverDB.delete(users).where(inArray(users.id, userIds));
  await serverDB.insert(users).values(userIds.map((id) => ({ id })));
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'WS', primaryOwnerId: ownerId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'Other', primaryOwnerId: otherOwnerId, slug: otherWorkspaceId },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'owner', userId: otherOwnerId, workspaceId: otherWorkspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, userIds));
});

describe('WorkspaceTeamModel coverage', () => {
  it('findByIds returns [] for no ids and only resolves teams of its own workspace', async () => {
    const model = new WorkspaceTeamModel(serverDB, workspaceId);
    const other = new WorkspaceTeamModel(serverDB, otherWorkspaceId);
    const own = await model.create({ createdBy: ownerId, identifier: 'OWN', name: 'Own' });
    const foreign = await other.create({
      createdBy: otherOwnerId,
      identifier: 'FOR',
      name: 'Foreign',
    });

    expect(await model.findByIds([])).toEqual([]);

    const found = await model.findByIds([own.id, foreign.id]);
    expect(found.map((team) => team.id)).toEqual([own.id]);
  });

  it('update writes an explicitly passed avatar and leaves omitted fields alone', async () => {
    const model = new WorkspaceTeamModel(serverDB, workspaceId);
    const team = await model.create({
      createdBy: ownerId,
      description: 'keep me',
      identifier: 'AVA',
      name: 'Avatar',
    });

    const updated = await model.update(team.id, { avatar: '🚀' });

    expect(updated).toMatchObject({
      avatar: '🚀',
      description: 'keep me',
      identifier: 'AVA',
      name: 'Avatar',
    });
  });

  it('addMembers returns [] without touching the team when no user ids are given', async () => {
    const model = new WorkspaceTeamModel(serverDB, workspaceId);
    const team = await model.create({ createdBy: ownerId, identifier: 'EMP', name: 'Empty' });

    expect(await model.addMembers(team.id, [])).toEqual([]);
    expect(await model.listMemberUserIds(team.id)).toEqual([]);
  });
});
