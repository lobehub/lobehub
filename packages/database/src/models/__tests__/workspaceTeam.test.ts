import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  users,
  workspaceMembers,
  workspaces,
  workspaceTeamMembers,
  workspaceTeams,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { deriveTeamIdentifier, WorkspaceTeamModel } from '../workspaceTeam';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'wt-owner';
const memberId = 'wt-member';
const otherUserId = 'wt-other';
const workspaceId = 'wt-workspace';
const otherWorkspaceId = 'wt-other-workspace';
const outsiderId = 'wt-outsider';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB
    .insert(users)
    .values([{ id: ownerId }, { id: memberId }, { id: otherUserId }, { id: outsiderId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'WS', primaryOwnerId: ownerId, slug: 'wt-ws' },
    { id: otherWorkspaceId, name: 'Other', primaryOwnerId: otherUserId, slug: 'wt-other-ws' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
    { role: 'owner', userId: otherUserId, workspaceId: otherWorkspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('WorkspaceTeamModel', () => {
  describe('create / list', () => {
    it('creates a team with initial members and counts them in list', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);

      const team = await model.create({
        avatar: '🛠️',
        createdBy: ownerId,
        description: 'Builds things',
        identifier: 'ENG',
        memberUserIds: [ownerId, memberId, memberId],
        name: 'Engineering',
      });

      expect(team.identifier).toBe('ENG');
      expect(team.workspaceId).toBe(workspaceId);

      const list = await model.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: team.id, memberCount: 2, name: 'Engineering' });
    });

    it('lists teams alphabetically and only for its own workspace', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);
      await model.create({ createdBy: ownerId, identifier: 'QA', name: 'QA' });
      await model.create({ createdBy: ownerId, identifier: 'BM', name: 'Benchmark' });
      await new WorkspaceTeamModel(serverDB, otherWorkspaceId).create({
        createdBy: otherUserId,
        identifier: 'ENG',
        name: 'Elsewhere',
      });

      const list = await model.list();
      expect(list.map((team) => team.name)).toEqual(['Benchmark', 'QA']);
      expect(list.every((team) => team.memberCount === 0)).toBe(true);
    });

    it('enforces identifier uniqueness per workspace but not across workspaces', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);
      await model.create({ createdBy: ownerId, identifier: 'ENG', name: 'Engineering' });

      await expect(
        model.create({ createdBy: ownerId, identifier: 'ENG', name: 'Another' }),
      ).rejects.toThrow();

      await expect(
        new WorkspaceTeamModel(serverDB, otherWorkspaceId).create({
          createdBy: otherUserId,
          identifier: 'ENG',
          name: 'Engineering',
        }),
      ).resolves.toMatchObject({ identifier: 'ENG' });
    });
  });

  describe('isIdentifierTaken', () => {
    it('detects taken identifiers and ignores the excluded team', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);
      const team = await model.create({ createdBy: ownerId, identifier: 'ENG', name: 'Eng' });

      expect(await model.isIdentifierTaken('ENG')).toBe(true);
      expect(await model.isIdentifierTaken('ENG', team.id)).toBe(false);
      expect(await model.isIdentifierTaken('OPS')).toBe(false);
      expect(
        await new WorkspaceTeamModel(serverDB, otherWorkspaceId).isIdentifierTaken('ENG'),
      ).toBe(false);
    });
  });

  describe('findById / update / delete', () => {
    it('does not resolve a team through another workspace', async () => {
      const team = await new WorkspaceTeamModel(serverDB, workspaceId).create({
        createdBy: ownerId,
        identifier: 'ENG',
        name: 'Eng',
      });
      const foreign = new WorkspaceTeamModel(serverDB, otherWorkspaceId);

      expect(await foreign.findById(team.id)).toBeUndefined();
      expect(await foreign.update(team.id, { name: 'Hijacked' })).toBeUndefined();
      expect(await foreign.delete(team.id)).toBeUndefined();
      expect((await new WorkspaceTeamModel(serverDB, workspaceId).findById(team.id))?.name).toBe(
        'Eng',
      );
    });

    it('applies partial updates', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);
      const team = await model.create({
        createdBy: ownerId,
        description: 'old',
        identifier: 'ENG',
        name: 'Eng',
      });

      const updated = await model.update(team.id, { description: null, identifier: 'PLAT' });

      expect(updated).toMatchObject({ description: null, identifier: 'PLAT', name: 'Eng' });
    });

    it('cascades memberships when a team is deleted', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);
      const team = await model.create({
        createdBy: ownerId,
        identifier: 'ENG',
        memberUserIds: [memberId],
        name: 'Eng',
      });

      expect((await model.delete(team.id))?.id).toBe(team.id);

      const rows = await serverDB
        .select()
        .from(workspaceTeamMembers)
        .where(eq(workspaceTeamMembers.teamId, team.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('members', () => {
    it('adds members idempotently and lists them', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);
      const team = await model.create({ createdBy: ownerId, identifier: 'ENG', name: 'Eng' });

      expect(await model.addMembers(team.id, [ownerId, memberId])).toEqual(
        expect.arrayContaining([ownerId, memberId]),
      );
      expect(await model.addMembers(team.id, [memberId])).toEqual([]);

      const members = await model.listMembers(team.id);
      expect(members.map((m) => m.userId).sort()).toEqual([memberId, ownerId].sort());
      expect(members.every((m) => m.role === 'member')).toBe(true);
    });

    it('does not add members to a team of another workspace', async () => {
      const team = await new WorkspaceTeamModel(serverDB, workspaceId).create({
        createdBy: ownerId,
        identifier: 'ENG',
        name: 'Eng',
      });

      expect(
        await new WorkspaceTeamModel(serverDB, otherWorkspaceId).addMembers(team.id, [otherUserId]),
      ).toEqual([]);
      expect(
        await new WorkspaceTeamModel(serverDB, workspaceId).listMemberUserIds(team.id),
      ).toEqual([]);
    });

    it('only adds active members of the workspace', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);
      const team = await model.create({
        createdBy: ownerId,
        identifier: 'ENG',
        // Outsiders are dropped at creation too.
        memberUserIds: [ownerId, outsiderId],
        name: 'Eng',
      });
      await serverDB
        .update(workspaceMembers)
        .set({ deletedAt: new Date() })
        .where(eq(workspaceMembers.userId, memberId));

      expect(await model.addMembers(team.id, [memberId, outsiderId, otherUserId])).toEqual([]);
      expect(await model.listMemberUserIds(team.id)).toEqual([ownerId]);
    });

    it('removes a single member', async () => {
      const model = new WorkspaceTeamModel(serverDB, workspaceId);
      const team = await model.create({
        createdBy: ownerId,
        identifier: 'ENG',
        memberUserIds: [ownerId, memberId],
        name: 'Eng',
      });

      expect(await model.removeMember(team.id, memberId)).toBe(true);
      expect(await model.removeMember(team.id, memberId)).toBe(false);
      expect(await model.listMemberUserIds(team.id)).toEqual([ownerId]);
    });
  });

  describe('deriveTeamIdentifier', () => {
    it.each([
      ['Engineering', 'ENG'],
      ['Customer Support', 'CS'],
      ['2024 Launch Squad', 'LS'],
      ['123Engineering', 'ENG'],
      ['研发', ''],
    ])('%s → %s', (name, expected) => {
      expect(deriveTeamIdentifier(name)).toBe(expected);
    });
  });

  it('keeps team rows when the creator is deleted', async () => {
    const model = new WorkspaceTeamModel(serverDB, workspaceId);
    const team = await model.create({ createdBy: memberId, identifier: 'ENG', name: 'Eng' });

    await serverDB.delete(users).where(eq(users.id, memberId));

    const [row] = await serverDB
      .select()
      .from(workspaceTeams)
      .where(eq(workspaceTeams.id, team.id));
    expect(row.createdBy).toBeNull();
  });
});
