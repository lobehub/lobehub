// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { getTestDB } from '../../core/getTestDB';
import type { NewChatGroup } from '../../schemas';
import { agents as agentsTable, chatGroups, chatGroupsAgents, users } from '../../schemas';
import { ChatGroupModel } from '../chatGroup';

const userId = 'test-user';
const otherUserId = 'other-user';

const serverDB: LobeChatDatabase = await getTestDB();

type RelationAgent = {
  agentId: string;
  chatGroupId?: string;
  enabled?: boolean | null;
  order?: number | null;
  role?: string | null;
};

const toRelationAgents = (agents: unknown): RelationAgent[] => agents as RelationAgent[];

const chatGroupModel = new ChatGroupModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  // Clean up test data
  await serverDB.delete(users);
});

describe('ChatGroupModel', () => {
  describe('findById', () => {
    it('should find chat group by ID for current user', async () => {
      // Create test data
      const testGroup: NewChatGroup = {
        id: 'test-group-1',
        userId,
        title: 'Test Group',
        description: 'Test group description',
        pinned: false,
      };

      await serverDB.insert(chatGroups).values(testGroup);

      // Test finding the group
      const result = await chatGroupModel.findById('test-group-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-group-1');
      expect(result?.title).toBe('Test Group');
      expect(result?.userId).toBe(userId);
    });

    it('should return undefined for non-existent group', async () => {
      const result = await chatGroupModel.findById('non-existent');
      expect(result).toBeUndefined();
    });

    it('should not find groups belonging to other users', async () => {
      // Create group for other user
      await serverDB.insert(chatGroups).values({
        id: 'other-group',
        userId: otherUserId,
        title: 'Other User Group',
      });

      // Should not find it
      const result = await chatGroupModel.findById('other-group');
      expect(result).toBeUndefined();
    });
  });

  describe('query', () => {
    it('should return chat groups for current user only', async () => {
      // Create test data
      await serverDB.insert(chatGroups).values([
        {
          id: 'group-1',
          userId,
          title: 'Group 1',
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'group-2',
          userId,
          title: 'Group 2',
          updatedAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'group-3',
          userId: otherUserId,
          title: 'Other Group',
          updatedAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);

      const result = await chatGroupModel.query();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('group-2'); // Most recent first (desc order)
      expect(result[1].id).toBe('group-1');
      expect(result.every((group) => group.userId === userId)).toBe(true);
    });

    it('should return empty array when no groups exist', async () => {
      const result = await chatGroupModel.query();
      expect(result).toEqual([]);
    });
  });

  describe('queryWithMemberDetails', () => {
    it('should return groups with their agent members', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        // Create groups
        await trx.insert(chatGroups).values([
          { id: 'group-1', userId, title: 'Group 1' },
          { id: 'group-2', userId, title: 'Group 2' },
        ]);

        // Create agents
        await trx.insert(agentsTable).values([
          { id: 'agent-1', userId, title: 'Agent 1' },
          { id: 'agent-2', userId, title: 'Agent 2' },
          { id: 'agent-3', userId, title: 'Agent 3' },
        ]);

        // Link agents to groups
        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'group-1', agentId: 'agent-1', userId },
          { chatGroupId: 'group-1', agentId: 'agent-2', userId },
          { chatGroupId: 'group-2', agentId: 'agent-3', userId },
        ]);
      });

      const result = await chatGroupModel.queryWithMemberDetails();

      expect(result).toHaveLength(2);

      const group1 = result.find((g) => g.id === 'group-1');
      expect(group1?.agents).toHaveLength(2);
      expect(group1?.agents.map((m: any) => m.title)).toEqual(
        expect.arrayContaining(['Agent 1', 'Agent 2']),
      );

      const group2 = result.find((g) => g.id === 'group-2');
      expect(group2?.agents).toHaveLength(1);
      expect(group2?.agents[0].title).toBe('Agent 3');
    });

    it('should return groups with empty agents array when no agents assigned', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'group-no-agents',
        userId,
        title: 'Group without agents',
      });

      const result = await chatGroupModel.queryWithMemberDetails();

      expect(result).toHaveLength(1);
      expect(result[0].agents).toEqual([]);
    });

    it('should return empty array when no groups exist', async () => {
      const result = await chatGroupModel.queryWithMemberDetails();
      expect(result).toEqual([]);
    });
  });

  describe('findGroupWithAgents', () => {
    it('should return group with its agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'group-with-agents',
          userId,
          title: 'Group with Agents',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-1', userId, title: 'Agent 1' },
          { id: 'agent-2', userId, title: 'Agent 2' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'group-with-agents', agentId: 'agent-1', userId, order: 1 },
          { chatGroupId: 'group-with-agents', agentId: 'agent-2', userId, order: 2 },
        ]);
      });

      const result = await chatGroupModel.findGroupWithAgents('group-with-agents');

      expect(result).toBeDefined();
      expect(result?.group.id).toBe('group-with-agents');
      const agents = toRelationAgents(result?.agents ?? []);
      expect(agents).toHaveLength(2);
      // Should be ordered by order field
      expect(agents[0]?.agentId).toBe('agent-1');
      expect(agents[1]?.agentId).toBe('agent-2');
    });

    it('should return null for non-existent group', async () => {
      const result = await chatGroupModel.findGroupWithAgents('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new chat group', async () => {
      const groupData: Omit<NewChatGroup, 'userId'> = {
        title: 'New Chat Group',
        description: 'A test chat group',
        pinned: true,
        config: {
          allowDM: true,
          revealDM: false,
        },
      };

      const result = await chatGroupModel.create(groupData);

      expect(result).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.title).toBe('New Chat Group');
      expect(result.description).toBe('A test chat group');
      expect(result.pinned).toBe(true);
      expect(result.config).toEqual({
        allowDM: true,
        revealDM: false,
      });
      expect(result.id.startsWith('cg_')).toBe(true);
    });

    it('should create group with custom ID', async () => {
      const groupData: Omit<NewChatGroup, 'userId'> = {
        id: 'custom-group-id',
        title: 'Custom ID Group',
      };

      const result = await chatGroupModel.create(groupData);

      expect(result.id).toBe('custom-group-id');
      expect(result.title).toBe('Custom ID Group');
    });
  });

  describe('createWithAgents', () => {
    it('should create group and add agents', async () => {
      // Create test agents
      await serverDB.insert(agentsTable).values([
        { id: 'agent-1', userId, title: 'Agent 1' },
        { id: 'agent-2', userId, title: 'Agent 2' },
      ]);

      const groupData: Omit<NewChatGroup, 'userId'> = {
        title: 'Group with Agents',
        description: 'Group created with agents',
      };

      const result = await chatGroupModel.createWithAgents(groupData, ['agent-1', 'agent-2']);

      expect(result.group).toBeDefined();
      expect(result.group.title).toBe('Group with Agents');
      expect(result.agents).toHaveLength(2);
      expect(result.agents[0].agentId).toBe('agent-1');
      expect(result.agents[1].agentId).toBe('agent-2');
    });

    it('should create group with empty agents array', async () => {
      const groupData: Omit<NewChatGroup, 'userId'> = {
        title: 'Empty Group',
      };

      const result = await chatGroupModel.createWithAgents(groupData, []);

      expect(result.group).toBeDefined();
      expect(result.agents).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update chat group', async () => {
      // Create test group
      await serverDB.insert(chatGroups).values({
        id: 'update-test',
        userId,
        title: 'Original Title',
        description: 'Original description',
        pinned: false,
      });

      const updatedData = {
        title: 'Updated Title',
        description: 'Updated description',
        pinned: true,
      };

      const result = await chatGroupModel.update('update-test', updatedData);

      expect(result.id).toBe('update-test');
      expect(result.title).toBe('Updated Title');
      expect(result.description).toBe('Updated description');
      expect(result.pinned).toBe(true);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should not update groups belonging to other users', async () => {
      // Create group for other user
      await serverDB.insert(chatGroups).values({
        id: 'other-user-group',
        userId: otherUserId,
        title: 'Other User Group',
      });

      // Try to update - should throw
      await expect(
        chatGroupModel.update('other-user-group', { title: 'Hacked Title' }),
      ).rejects.toThrow('Chat group not found or access denied');
    });
  });

  describe('addAgentToGroup', () => {
    it('should add agent to group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'test-group',
          userId,
          title: 'Test Group',
        });

        await trx.insert(agentsTable).values({
          id: 'test-agent',
          userId,
          title: 'Test Agent',
        });
      });

      const result = await chatGroupModel.addAgentToGroup('test-group', 'test-agent', {
        order: 5,
        role: 'moderator',
      });

      expect(result.chatGroupId).toBe('test-group');
      expect(result.agentId).toBe('test-agent');
      expect(result.userId).toBe(userId);
      expect(result.order).toBe(5);
      expect(result.role).toBe('moderator');
    });

    it('should add agent with default options', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'test-group-2',
          userId,
          title: 'Test Group 2',
        });

        await trx.insert(agentsTable).values({
          id: 'test-agent-2',
          userId,
          title: 'Test Agent 2',
        });
      });

      const result = await chatGroupModel.addAgentToGroup('test-group-2', 'test-agent-2');

      expect(result.order).toBe(0);
      expect(result.role).toBe('assistant');
    });
  });

  describe('addAgentsToGroup', () => {
    it('should add multiple agents to group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'multi-agent-group',
          userId,
          title: 'Multi Agent Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-1', userId, title: 'Agent 1' },
          { id: 'agent-2', userId, title: 'Agent 2' },
          { id: 'agent-3', userId, title: 'Agent 3' },
        ]);
      });

      const result = await chatGroupModel.addAgentsToGroup('multi-agent-group', [
        'agent-1',
        'agent-2',
        'agent-3',
      ]);

      expect(result.added).toHaveLength(3);
      expect(result.added.map((a) => a.agentId)).toEqual(['agent-1', 'agent-2', 'agent-3']);
      expect(result.existing).toHaveLength(0);
    });

    it('should skip existing agents and only add new ones', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'existing-agent-group',
          userId,
          title: 'Existing Agent Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'existing-agent', userId, title: 'Existing Agent' },
          { id: 'new-agent', userId, title: 'New Agent' },
        ]);

        // Add one agent already
        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'existing-agent-group',
          agentId: 'existing-agent',
          userId,
        });
      });

      const result = await chatGroupModel.addAgentsToGroup('existing-agent-group', [
        'existing-agent',
        'new-agent',
      ]);

      // Should only add new-agent, and report existing-agent as skipped
      expect(result.added).toHaveLength(1);
      expect(result.added[0].agentId).toBe('new-agent');
      expect(result.existing).toEqual(['existing-agent']);

      // Verify total agents in group
      const groupAgents = await chatGroupModel.getGroupAgents('existing-agent-group');
      expect(groupAgents).toHaveLength(2);
    });

    it('should return empty added array when all agents already exist', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'all-existing-group',
          userId,
          title: 'All Existing Group',
        });

        await trx.insert(agentsTable).values({
          id: 'existing-only',
          userId,
          title: 'Existing Only',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'all-existing-group',
          agentId: 'existing-only',
          userId,
        });
      });

      const result = await chatGroupModel.addAgentsToGroup('all-existing-group', ['existing-only']);

      expect(result.added).toHaveLength(0);
      expect(result.existing).toEqual(['existing-only']);
    });

    it('should throw error for non-existent group', async () => {
      await expect(
        chatGroupModel.addAgentsToGroup('non-existent-group', ['agent-1']),
      ).rejects.toThrow('Group not found');
    });
  });

  describe('removeAgentFromGroup', () => {
    it('should remove agent from group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'remove-test-group',
          userId,
          title: 'Remove Test Group',
        });

        await trx.insert(agentsTable).values({
          id: 'remove-test-agent',
          userId,
          title: 'Remove Test Agent',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'remove-test-group',
          agentId: 'remove-test-agent',
          userId,
        });
      });

      await chatGroupModel.removeAgentFromGroup('remove-test-group', 'remove-test-agent');

      // Verify agent was removed
      const groupAgents = await chatGroupModel.getGroupAgents('remove-test-group');
      expect(groupAgents).toHaveLength(0);
    });

    it('should handle removing non-existent agent gracefully', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'empty-group',
        userId,
        title: 'Empty Group',
      });

      // Should not throw error
      await expect(
        chatGroupModel.removeAgentFromGroup('empty-group', 'non-existent-agent'),
      ).resolves.not.toThrow();
    });
  });

  describe('removeAgentsFromGroup', () => {
    it('should remove multiple agents from group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'batch-remove-group',
          userId,
          title: 'Batch Remove Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-to-remove-1', userId, title: 'Agent 1' },
          { id: 'agent-to-remove-2', userId, title: 'Agent 2' },
          { id: 'agent-to-keep', userId, title: 'Agent to Keep' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'batch-remove-group', agentId: 'agent-to-remove-1', userId },
          { chatGroupId: 'batch-remove-group', agentId: 'agent-to-remove-2', userId },
          { chatGroupId: 'batch-remove-group', agentId: 'agent-to-keep', userId },
        ]);
      });

      await chatGroupModel.removeAgentsFromGroup('batch-remove-group', [
        'agent-to-remove-1',
        'agent-to-remove-2',
      ]);

      // Verify only the specified agents were removed
      const groupAgents = toRelationAgents(
        await chatGroupModel.getGroupAgents('batch-remove-group'),
      );
      expect(groupAgents).toHaveLength(1);
      expect(groupAgents[0]?.agentId).toBe('agent-to-keep');
    });

    it('should handle empty agentIds array gracefully', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'empty-remove-group',
          userId,
          title: 'Empty Remove Group',
        });

        await trx.insert(agentsTable).values({
          id: 'agent-stays',
          userId,
          title: 'Agent Stays',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'empty-remove-group',
          agentId: 'agent-stays',
          userId,
        });
      });

      // Should not throw error and should not remove any agents
      await expect(
        chatGroupModel.removeAgentsFromGroup('empty-remove-group', []),
      ).resolves.not.toThrow();

      const groupAgents = toRelationAgents(
        await chatGroupModel.getGroupAgents('empty-remove-group'),
      );
      expect(groupAgents).toHaveLength(1);
    });

    it('should handle removing non-existent agents gracefully', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'no-match-group',
        userId,
        title: 'No Match Group',
      });

      // Should not throw error
      await expect(
        chatGroupModel.removeAgentsFromGroup('no-match-group', [
          'non-existent-1',
          'non-existent-2',
        ]),
      ).resolves.not.toThrow();
    });

    it('should remove all agents when all are specified', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'remove-all-group',
          userId,
          title: 'Remove All Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'remove-all-1', userId, title: 'Remove All 1' },
          { id: 'remove-all-2', userId, title: 'Remove All 2' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'remove-all-group', agentId: 'remove-all-1', userId },
          { chatGroupId: 'remove-all-group', agentId: 'remove-all-2', userId },
        ]);
      });

      await chatGroupModel.removeAgentsFromGroup('remove-all-group', [
        'remove-all-1',
        'remove-all-2',
      ]);

      const groupAgents = await chatGroupModel.getGroupAgents('remove-all-group');
      expect(groupAgents).toHaveLength(0);
    });
  });

  describe('updateAgentInGroup', () => {
    it('should update agent settings in group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'update-agent-group',
          userId,
          title: 'Update Agent Group',
        });

        await trx.insert(agentsTable).values({
          id: 'update-agent',
          userId,
          title: 'Update Agent',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'update-agent-group',
          agentId: 'update-agent',
          userId,
          enabled: true,
          order: 0,
          role: 'participant',
        });
      });

      const result = await chatGroupModel.updateAgentInGroup('update-agent-group', 'update-agent', {
        order: 5,
        role: 'moderator',
      });

      expect(result.order).toBe(5);
      expect(result.role).toBe('moderator');
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('delete', () => {
    it('should delete chat group', async () => {
      // Create test group
      await serverDB.insert(chatGroups).values({
        id: 'delete-test',
        userId,
        title: 'Delete Test',
      });

      const result = await chatGroupModel.delete('delete-test');

      expect(result.id).toBe('delete-test');

      // Verify group was deleted
      const groups = await serverDB
        .select()
        .from(chatGroups)
        .where(eq(chatGroups.id, 'delete-test'));
      expect(groups).toHaveLength(0);
    });

    it('should cascade delete associated agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'cascade-delete-group',
          userId,
          title: 'Cascade Delete Group',
        });

        await trx.insert(agentsTable).values({
          id: 'cascade-agent',
          userId,
          title: 'Cascade Agent',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'cascade-delete-group',
          agentId: 'cascade-agent',
          userId,
        });
      });

      await chatGroupModel.delete('cascade-delete-group');

      // Verify group and associated agents were deleted
      const groupAgents = await serverDB
        .select()
        .from(chatGroupsAgents)
        .where(eq(chatGroupsAgents.chatGroupId, 'cascade-delete-group'));
      expect(groupAgents).toHaveLength(0);
    });

    it('should not delete groups belonging to other users', async () => {
      // Create group for other user
      await serverDB.insert(chatGroups).values({
        id: 'other-user-delete',
        userId: otherUserId,
        title: 'Other User Delete',
      });

      // Try to delete - should throw
      await expect(chatGroupModel.delete('other-user-delete')).rejects.toThrow(
        'Chat group not found or access denied',
      );
    });
  });

  describe('deleteAll', () => {
    it('should delete all groups for current user only', async () => {
      // Create test data
      await serverDB.insert(chatGroups).values([
        { id: 'user-group-1', userId, title: 'User Group 1' },
        { id: 'user-group-2', userId, title: 'User Group 2' },
        { id: 'other-group', userId: otherUserId, title: 'Other Group' },
      ]);

      await chatGroupModel.deleteAll();

      // Verify only current user's groups were deleted
      const remainingGroups = await serverDB.select().from(chatGroups);
      expect(remainingGroups).toHaveLength(1);
      expect(remainingGroups[0].userId).toBe(otherUserId);
    });
  });

  describe('getGroupAgents', () => {
    it('should return agents in group ordered by order field', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'ordered-group',
          userId,
          title: 'Ordered Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-1', userId, title: 'Agent 1' },
          { id: 'agent-2', userId, title: 'Agent 2' },
          { id: 'agent-3', userId, title: 'Agent 3' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'ordered-group', agentId: 'agent-1', userId, order: 2 },
          { chatGroupId: 'ordered-group', agentId: 'agent-2', userId, order: 1 },
          { chatGroupId: 'ordered-group', agentId: 'agent-3', userId, order: 3 },
        ]);
      });

      const result = toRelationAgents(await chatGroupModel.getGroupAgents('ordered-group'));

      expect(result).toHaveLength(3);
      expect(result[0]?.agentId).toBe('agent-2'); // order: 1
      expect(result[1]?.agentId).toBe('agent-1'); // order: 2
      expect(result[2]?.agentId).toBe('agent-3'); // order: 3
    });

    it('should handle numeric ordering correctly (avoiding lexicographic sorting)', async () => {
      // This test ensures that order 10 comes after order 2 (not before like with text sorting)
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'numeric-order-group',
          userId,
          title: 'Numeric Order Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-order-1', userId, title: 'Agent Order 1' },
          { id: 'agent-order-2', userId, title: 'Agent Order 2' },
          { id: 'agent-order-10', userId, title: 'Agent Order 10' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'numeric-order-group', agentId: 'agent-order-10', userId, order: 10 },
          { chatGroupId: 'numeric-order-group', agentId: 'agent-order-2', userId, order: 2 },
          { chatGroupId: 'numeric-order-group', agentId: 'agent-order-1', userId, order: 1 },
        ]);
      });

      const result = toRelationAgents(await chatGroupModel.getGroupAgents('numeric-order-group'));

      expect(result).toHaveLength(3);
      // With integer ordering: 1, 2, 10 (correct)
      // With text ordering it would be: 1, 10, 2 (incorrect lexicographic)
      expect(result[0]?.agentId).toBe('agent-order-1'); // order: 1
      expect(result[1]?.agentId).toBe('agent-order-2'); // order: 2
      expect(result[2]?.agentId).toBe('agent-order-10'); // order: 10
    });
  });

  describe('getEnabledGroupAgents', () => {
    it('should return only enabled agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'enabled-test-group',
          userId,
          title: 'Enabled Test Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'enabled-agent', userId, title: 'Enabled Agent' },
          { id: 'disabled-agent', userId, title: 'Disabled Agent' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'enabled-test-group', agentId: 'enabled-agent', userId, enabled: true },
          { chatGroupId: 'enabled-test-group', agentId: 'disabled-agent', userId, enabled: false },
        ]);
      });

      const result = toRelationAgents(
        await chatGroupModel.getEnabledGroupAgents('enabled-test-group'),
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.agentId).toBe('enabled-agent');
    });
  });

  describe('getGroupsWithAgents', () => {
    it('should return groups containing specified agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values([
          { id: 'group-a', userId, title: 'Group A' },
          { id: 'group-b', userId, title: 'Group B' },
          { id: 'group-c', userId, title: 'Group C' },
        ]);

        await trx.insert(agentsTable).values([
          { id: 'agent-x', userId, title: 'Agent X' },
          { id: 'agent-y', userId, title: 'Agent Y' },
          { id: 'agent-z', userId, title: 'Agent Z' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'group-a', agentId: 'agent-x', userId },
          { chatGroupId: 'group-a', agentId: 'agent-y', userId },
          { chatGroupId: 'group-b', agentId: 'agent-y', userId },
          { chatGroupId: 'group-c', agentId: 'agent-z', userId },
        ]);
      });

      const result = await chatGroupModel.getGroupsWithAgents(['agent-x', 'agent-y']);

      expect(result).toHaveLength(2);
      expect(result.map((g) => g.id)).toEqual(expect.arrayContaining(['group-a', 'group-b']));
    });

    it('should return all groups when no agentIds provided', async () => {
      await serverDB.insert(chatGroups).values([
        { id: 'all-group-1', userId, title: 'All Group 1' },
        { id: 'all-group-2', userId, title: 'All Group 2' },
      ]);

      const result = await chatGroupModel.getGroupsWithAgents();

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no matching groups found', async () => {
      const result = await chatGroupModel.getGroupsWithAgents(['non-existent-agent']);
      expect(result).toEqual([]);
    });

    it('should only return groups for current user', async () => {
      // Create test data for multiple users
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values([
          { id: 'user-group', userId, title: 'User Group' },
          { id: 'other-user-group', userId: otherUserId, title: 'Other User Group' },
        ]);

        await trx.insert(agentsTable).values([
          { id: 'user-agent', userId, title: 'User Agent' },
          { id: 'other-agent', userId: otherUserId, title: 'Other Agent' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'user-group', agentId: 'user-agent', userId },
          { chatGroupId: 'other-user-group', agentId: 'other-agent', userId: otherUserId },
        ]);
      });

      const result = await chatGroupModel.getGroupsWithAgents(['user-agent', 'other-agent']);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-group');
      expect(result[0].userId).toBe(userId);
    });
  });
});
