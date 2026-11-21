// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { getTestDB } from '../../core/getTestDB';
import {
  agents as agentsTable,
  chatGroups,
  chatGroupsAgents,
  sessionGroups,
  users,
  workspaces,
} from '../../schemas';
import { ChatGroupModel } from '../chatGroup';

const userId = 'cg-vis-user';
const otherUserId = 'cg-vis-other';
const workspaceId = 'cg-vis-workspace';
const foreignWorkspaceId = 'cg-vis-foreign-workspace';

const serverDB: LobeChatDatabase = await getTestDB();

const personalModel = new ChatGroupModel(serverDB, userId);
const workspaceModel = new ChatGroupModel(serverDB, userId, workspaceId);
const foreignWorkspaceModel = new ChatGroupModel(serverDB, userId, foreignWorkspaceId);
/** A second member of the same workspace — used to prove what is *not* ownership-scoped. */
const otherMemberModel = new ChatGroupModel(serverDB, otherUserId, workspaceId);

const readAgentVisibility = async (agentId: string) => {
  const [row] = await serverDB
    .select({ visibility: agentsTable.visibility })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));

  return row?.visibility;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Chat Group Visibility', primaryOwnerId: userId, slug: workspaceId },
    {
      id: foreignWorkspaceId,
      name: 'Foreign Workspace',
      primaryOwnerId: userId,
      slug: foreignWorkspaceId,
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ChatGroupModel visibility scope', () => {
  describe('getSupervisorAgentId', () => {
    it('resolves the personal supervisor and hides it from workspace scope', async () => {
      await serverDB.insert(chatGroups).values({ id: 'cg-personal', title: 'Personal', userId });
      await serverDB
        .insert(agentsTable)
        .values({ id: 'agt-personal-sup', title: 'Supervisor', userId, virtual: true });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'agt-personal-sup',
        chatGroupId: 'cg-personal',
        order: -1,
        role: 'supervisor',
        userId,
      });

      await expect(personalModel.getSupervisorAgentId('cg-personal')).resolves.toBe(
        'agt-personal-sup',
      );
      // A personal junction row carries no workspace id, so a workspace-scoped
      // caller must not resolve it.
      await expect(workspaceModel.getSupervisorAgentId('cg-personal')).resolves.toBeNull();
    });

    it('returns null when no supervisor row exists', async () => {
      await serverDB
        .insert(chatGroups)
        .values({ id: 'cg-no-supervisor', title: 'Members only', userId });
      await serverDB
        .insert(agentsTable)
        .values({ id: 'agt-plain-member', title: 'Member', userId });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'agt-plain-member',
        chatGroupId: 'cg-no-supervisor',
        order: 0,
        role: 'participant',
        userId,
      });

      await expect(personalModel.getSupervisorAgentId('cg-no-supervisor')).resolves.toBeNull();
    });

    it('scopes workspace supervisors by workspace rather than by ownership', async () => {
      await serverDB
        .insert(chatGroups)
        .values({ id: 'cg-workspace', title: 'Workspace group', userId, workspaceId });
      await serverDB.insert(agentsTable).values({
        id: 'agt-workspace-sup',
        title: 'Supervisor',
        userId,
        virtual: true,
        visibility: 'private',
        workspaceId,
      });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'agt-workspace-sup',
        chatGroupId: 'cg-workspace',
        order: -1,
        role: 'supervisor',
        userId,
        workspaceId,
      });

      await expect(workspaceModel.getSupervisorAgentId('cg-workspace')).resolves.toBe(
        'agt-workspace-sup',
      );
      // Deliberate: the supervisor's permission policies must resolve for any
      // member of the workspace, including one who cannot see the group row.
      await expect(otherMemberModel.getSupervisorAgentId('cg-workspace')).resolves.toBe(
        'agt-workspace-sup',
      );
      // A different workspace must not resolve it.
      await expect(foreignWorkspaceModel.getSupervisorAgentId('cg-workspace')).resolves.toBeNull();
    });
  });

  describe('update with a sidebar folder', () => {
    it("assigns a personal group to the caller's own folder", async () => {
      await serverDB
        .insert(sessionGroups)
        .values({ id: 'folder-personal', name: 'Personal folder', userId });
      await serverDB.insert(chatGroups).values({ id: 'cg-folder', title: 'Group', userId });

      const updated = await personalModel.update('cg-folder', { groupId: 'folder-personal' });

      expect(updated.groupId).toBe('folder-personal');
    });

    it("refuses a folder outside the caller's scope", async () => {
      await serverDB
        .insert(sessionGroups)
        .values({ id: 'folder-foreign', name: 'Foreign folder', userId: otherUserId });
      await serverDB.insert(chatGroups).values({ id: 'cg-foreign-folder', title: 'Group', userId });

      await expect(
        personalModel.update('cg-foreign-folder', { groupId: 'folder-foreign' }),
      ).rejects.toThrow('Session group folder-foreign not found in current scope');
    });

    it('refuses mixing folder and group visibilities inside a workspace', async () => {
      await serverDB.insert(sessionGroups).values([
        {
          id: 'folder-ws-private',
          name: 'Private folder',
          userId,
          visibility: 'private',
          workspaceId,
        },
        {
          id: 'folder-ws-public',
          name: 'Public folder',
          userId,
          visibility: 'public',
          workspaceId,
        },
      ]);
      await serverDB.insert(chatGroups).values({
        id: 'cg-ws-public',
        title: 'Public group',
        userId,
        visibility: 'public',
        workspaceId,
      });

      await expect(
        workspaceModel.update('cg-ws-public', { groupId: 'folder-ws-private' }),
      ).rejects.toThrow('A public chat group cannot be moved into a private folder');

      const moved = await workspaceModel.update('cg-ws-public', { groupId: 'folder-ws-public' });

      expect(moved.groupId).toBe('folder-ws-public');
    });

    it('lets a personal model move a group without checking folder visibility', async () => {
      await serverDB
        .insert(sessionGroups)
        .values({ id: 'folder-personal-public', name: 'Personal folder', userId });
      await serverDB
        .insert(chatGroups)
        .values({ id: 'cg-personal-move', title: 'Group', userId, visibility: 'private' });

      const updated = await personalModel.update('cg-personal-move', {
        groupId: 'folder-personal-public',
      });

      expect(updated.groupId).toBe('folder-personal-public');
    });
  });

  describe('publishToWorkspace guards', () => {
    it('refuses an already shared group and another member private group', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'cg-already-shared',
        title: 'Shared',
        userId,
        visibility: 'public',
        workspaceId,
      });
      await expect(workspaceModel.publishToWorkspace('cg-already-shared')).rejects.toThrow(
        'Chat group not found, already published, or access denied',
      );

      await serverDB.insert(chatGroups).values({
        id: 'cg-other-private',
        title: 'Other member group',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      });
      await expect(workspaceModel.publishToWorkspace('cg-other-private')).rejects.toThrow(
        'Chat group not found, already published, or access denied',
      );
    });

    it('releases a non-public folder and mirrors the supervisor on publish', async () => {
      await serverDB.insert(sessionGroups).values({
        id: 'folder-ws-private-publish',
        name: 'Private folder',
        userId,
        visibility: 'private',
        workspaceId,
      });
      await serverDB.insert(chatGroups).values({
        id: 'cg-publish',
        title: 'Private in private folder',
        userId,
        visibility: 'private',
        workspaceId,
        groupId: 'folder-ws-private-publish',
      });
      await serverDB.insert(agentsTable).values({
        id: 'agt-publish-sup',
        title: 'Supervisor',
        userId,
        virtual: true,
        visibility: 'private',
        workspaceId,
      });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'agt-publish-sup',
        chatGroupId: 'cg-publish',
        order: -1,
        role: 'supervisor',
        userId,
        workspaceId,
      });

      const published = await workspaceModel.publishToWorkspace('cg-publish');

      expect(published.visibility).toBe('public');
      expect(published.groupId).toBeNull();
      await expect(readAgentVisibility('agt-publish-sup')).resolves.toBe('public');
    });
  });

  describe('setVisibility', () => {
    it('promotes the group and mirrors the synthetic supervisor', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'cg-promote',
        title: 'Private group',
        userId,
        visibility: 'private',
        workspaceId,
      });
      await serverDB.insert(agentsTable).values({
        id: 'agt-promote-sup',
        title: 'Supervisor',
        userId,
        virtual: true,
        visibility: 'private',
        workspaceId,
      });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'agt-promote-sup',
        chatGroupId: 'cg-promote',
        order: -1,
        role: 'supervisor',
        userId,
        workspaceId,
      });

      const updated = await workspaceModel.setVisibility('cg-promote', 'public');

      expect(updated?.visibility).toBe('public');
      await expect(readAgentVisibility('agt-promote-sup')).resolves.toBe('public');
    });

    it('releases the folder when the new visibility no longer matches it', async () => {
      await serverDB.insert(sessionGroups).values({
        id: 'folder-ws-public-demote',
        name: 'Public folder',
        userId,
        visibility: 'public',
        workspaceId,
      });
      await serverDB.insert(chatGroups).values({
        id: 'cg-demote',
        title: 'Public in public folder',
        userId,
        visibility: 'public',
        workspaceId,
        groupId: 'folder-ws-public-demote',
      });

      const updated = await workspaceModel.setVisibility('cg-demote', 'private');

      expect(updated?.visibility).toBe('private');
      expect(updated?.groupId).toBeNull();
    });

    it('keeps the folder when its visibility still matches', async () => {
      await serverDB.insert(sessionGroups).values({
        id: 'folder-ws-private-keep',
        name: 'Private folder',
        userId,
        visibility: 'private',
        workspaceId,
      });
      await serverDB.insert(chatGroups).values({
        id: 'cg-keep-folder',
        title: 'Private in private folder',
        userId,
        visibility: 'private',
        workspaceId,
        groupId: 'folder-ws-private-keep',
      });

      const updated = await workspaceModel.setVisibility('cg-keep-folder', 'private');

      expect(updated?.groupId).toBe('folder-ws-private-keep');
    });

    it('returns null when the group is outside the caller scope', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'cg-out-of-scope',
        title: 'Other member private group',
        userId: otherUserId,
        visibility: 'private',
        workspaceId,
      });

      await expect(workspaceModel.setVisibility('cg-out-of-scope', 'public')).resolves.toBeNull();
    });
  });

  describe('getGroupAgentsByGroupIds', () => {
    it('returns an empty list for no group ids', async () => {
      await expect(personalModel.getGroupAgentsByGroupIds([])).resolves.toEqual([]);
    });

    it('reads rosters across the requested groups and drops invisible members', async () => {
      await serverDB.insert(chatGroups).values([
        { id: 'cg-roster-1', title: 'Roster one', userId, workspaceId },
        { id: 'cg-roster-2', title: 'Roster two', userId, workspaceId },
      ]);
      await serverDB.insert(agentsTable).values([
        { id: 'agt-roster-shared', title: 'Shared', userId, visibility: 'public', workspaceId },
        {
          id: 'agt-roster-foreign-private',
          title: 'Foreign private',
          userId: otherUserId,
          visibility: 'private',
          workspaceId,
        },
      ]);
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'agt-roster-shared',
          chatGroupId: 'cg-roster-1',
          order: 0,
          userId,
          workspaceId,
        },
        {
          agentId: 'agt-roster-foreign-private',
          chatGroupId: 'cg-roster-1',
          order: 1,
          userId,
          workspaceId,
        },
        {
          agentId: 'agt-roster-shared',
          chatGroupId: 'cg-roster-2',
          order: 0,
          userId,
          workspaceId,
        },
      ]);

      const rows = await workspaceModel.getGroupAgentsByGroupIds(['cg-roster-1', 'cg-roster-2']);

      // Another member's private agent never leaks into the roster.
      expect(rows.map((row) => `${row.chatGroupId}:${row.agentId}`)).toEqual([
        'cg-roster-1:agt-roster-shared',
        'cg-roster-2:agt-roster-shared',
      ]);
    });
  });

  describe('countPrivateGroupAgents', () => {
    it('counts private member agents but never the synthetic supervisor', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'cg-count',
        title: 'Private group',
        userId,
        visibility: 'private',
        workspaceId,
      });
      await serverDB.insert(agentsTable).values([
        {
          id: 'agt-count-sup',
          title: 'Supervisor',
          userId,
          virtual: true,
          visibility: 'private',
          workspaceId,
        },
        {
          id: 'agt-count-private',
          title: 'Private member',
          userId,
          visibility: 'private',
          workspaceId,
        },
        {
          id: 'agt-count-public',
          title: 'Public member',
          userId,
          visibility: 'public',
          workspaceId,
        },
      ]);
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'agt-count-sup',
          chatGroupId: 'cg-count',
          order: -1,
          role: 'supervisor',
          userId,
          workspaceId,
        },
        {
          agentId: 'agt-count-private',
          chatGroupId: 'cg-count',
          order: 0,
          role: 'participant',
          userId,
          workspaceId,
        },
        {
          agentId: 'agt-count-public',
          chatGroupId: 'cg-count',
          order: 1,
          role: 'participant',
          userId,
          workspaceId,
        },
      ]);

      await expect(workspaceModel.countPrivateGroupAgents('cg-count')).resolves.toBe(1);
      // Workspace rows are invisible to a personal-scoped caller.
      await expect(personalModel.countPrivateGroupAgents('cg-count')).resolves.toBe(0);
    });
  });
});
