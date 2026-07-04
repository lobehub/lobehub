// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ChatGroupModel } from '../../models/chatGroup';
import { agents } from '../../schemas/agent';
import { chatGroups, chatGroupsAgents } from '../../schemas/chatGroup';
import { messagePlugins, messages } from '../../schemas/message';
import { threads, topics } from '../../schemas/topic';
import { users } from '../../schemas/user';
import { workspaces } from '../../schemas/workspace';
import type { LobeChatDatabase } from '../../type';
import { AgentGroupRepository } from './index';

const userId = 'agent-group-test-user';
const otherUserId = 'other-agent-group-user';

let agentGroupRepo: AgentGroupRepository;

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize repo
  agentGroupRepo = new AgentGroupRepository(serverDB, userId);
});

describe('AgentGroupRepository', () => {
  describe('findByIdWithAgents', () => {
    it('should return group with its agents (including auto-created supervisor)', async () => {
      // Create test data
      await serverDB.insert(chatGroups).values({
        description: 'Test group description',
        id: 'test-group-1',
        title: 'Test Group',
        userId,
      });

      await serverDB.insert(agents).values([
        {
          avatar: 'avatar1.png',
          description: 'Agent 1 description',
          id: 'agent-1',
          title: 'Agent 1',
          userId,
        },
        {
          avatar: 'avatar2.png',
          description: 'Agent 2 description',
          id: 'agent-2',
          title: 'Agent 2',
          userId,
        },
      ]);

      // Link agents to group with order (as participants)
      await serverDB.insert(chatGroupsAgents).values([
        { agentId: 'agent-1', chatGroupId: 'test-group-1', order: 1, role: 'participant', userId },
        { agentId: 'agent-2', chatGroupId: 'test-group-1', order: 0, role: 'participant', userId },
      ]);

      const result = await agentGroupRepo.findByIdWithAgents('test-group-1');

      expect(result).toMatchObject({
        description: 'Test group description',
        id: 'test-group-1',
        title: 'Test Group',
      });
      // 2 participants + 1 auto-created supervisor
      expect(result!.agents).toHaveLength(3);
      expect(result!.supervisorAgentId).toBeDefined();

      // Verify agents structure: supervisor first, then participants ordered by order field
      expect(result!.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ isSupervisor: true, title: 'Supervisor', virtual: true }),
          expect.objectContaining({ id: 'agent-1', isSupervisor: false, title: 'Agent 1' }),
          expect.objectContaining({ id: 'agent-2', isSupervisor: false, title: 'Agent 2' }),
        ]),
      );
    });

    it('should return null for non-existent group', async () => {
      const result = await agentGroupRepo.findByIdWithAgents('non-existent-group');

      expect(result).toBeNull();
    });

    it('should auto-create supervisor when no agents assigned', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'empty-group',
        title: 'Empty Group',
        userId,
      });

      const result = await agentGroupRepo.findByIdWithAgents('empty-group');

      expect(result).toMatchObject({
        id: 'empty-group',
        title: 'Empty Group',
      });
      expect(result!.supervisorAgentId).toBeDefined();
      // Should have auto-created supervisor
      expect(result!.agents).toEqual([
        expect.objectContaining({ isSupervisor: true, title: 'Supervisor', virtual: true }),
      ]);
    });

    it('should not return groups belonging to other users', async () => {
      // Create group for other user
      await serverDB.insert(chatGroups).values({
        id: 'other-user-group',
        title: 'Other User Group',
        userId: otherUserId,
      });

      const result = await agentGroupRepo.findByIdWithAgents('other-user-group');

      expect(result).toBeNull();
    });

    it('should return full agent details including all fields', async () => {
      // Create supervisor agent first
      await serverDB.insert(agents).values({
        id: 'detail-supervisor',
        title: 'Supervisor',
        userId,
        virtual: true,
      });

      // Create group
      await serverDB.insert(chatGroups).values({
        config: { allowDM: true },
        id: 'detail-group',
        title: 'Detail Group',
        userId,
      });

      // Create agent with all fields
      await serverDB.insert(agents).values({
        avatar: 'test-avatar.png',
        backgroundColor: '#ff0000',
        description: 'Full agent description',
        id: 'full-agent',
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'You are a helpful assistant',
        title: 'Full Agent',
        userId,
      });

      // Link supervisor and participant agents
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'detail-supervisor',
          chatGroupId: 'detail-group',
          order: -1,
          role: 'supervisor',
          userId,
        },
        {
          agentId: 'full-agent',
          chatGroupId: 'detail-group',
          order: 0,
          role: 'participant',
          userId,
        },
      ]);

      const result = await agentGroupRepo.findByIdWithAgents('detail-group');

      expect(result).toMatchObject({
        id: 'detail-group',
        supervisorAgentId: 'detail-supervisor',
        title: 'Detail Group',
      });
      // 1 supervisor + 1 participant
      expect(result!.agents).toHaveLength(2);

      // Verify agents include full details
      expect(result!.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'detail-supervisor', isSupervisor: true, virtual: true }),
          expect.objectContaining({
            avatar: 'test-avatar.png',
            backgroundColor: '#ff0000',
            description: 'Full agent description',
            id: 'full-agent',
            isSupervisor: false,
            model: 'gpt-4',
            provider: 'openai',
            systemRole: 'You are a helpful assistant',
            title: 'Full Agent',
          }),
        ]),
      );
    });

    it('should return group with config', async () => {
      await serverDB.insert(chatGroups).values({
        config: {
          allowDM: true,
          openingMessage: 'Welcome!',
          revealDM: false,
        },
        description: 'Group with config',
        id: 'config-group',
        pinned: true,
        title: 'Config Group',
        userId,
      });

      const result = await agentGroupRepo.findByIdWithAgents('config-group');

      expect(result).not.toBeNull();
      expect(result!.config).toEqual({
        allowDM: true,
        openingMessage: 'Welcome!',
        revealDM: false,
      });
      expect(result!.pinned).toBe(true);
    });

    it('should return supervisorAgentId when supervisor exists', async () => {
      // Create group
      await serverDB.insert(chatGroups).values({
        id: 'supervisor-group',
        title: 'Group with Supervisor',
        userId,
      });

      // Create supervisor and participant agents
      await serverDB.insert(agents).values([
        { id: 'supervisor-agent', title: 'Supervisor', userId, virtual: true },
        { id: 'participant-agent', title: 'Participant', userId },
      ]);

      // Link agents with roles
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'supervisor-agent',
          chatGroupId: 'supervisor-group',
          order: -1,
          role: 'supervisor',
          userId,
        },
        {
          agentId: 'participant-agent',
          chatGroupId: 'supervisor-group',
          order: 0,
          role: 'participant',
          userId,
        },
      ]);

      const result = await agentGroupRepo.findByIdWithAgents('supervisor-group');

      expect(result).toMatchObject({
        id: 'supervisor-group',
        supervisorAgentId: 'supervisor-agent',
      });
      expect(result!.agents).toHaveLength(2);

      // Verify agents order: supervisor first due to order: -1
      expect(result!.agents).toEqual([
        expect.objectContaining({ id: 'supervisor-agent', isSupervisor: true }),
        expect.objectContaining({ id: 'participant-agent', isSupervisor: false }),
      ]);
    });

    it('should auto-create virtual supervisor when no supervisor exists', async () => {
      // Create group without supervisor
      await serverDB.insert(chatGroups).values({
        config: {
          allowDM: true,
          revealDM: true,
        },
        id: 'no-supervisor-group',
        title: 'Group without Supervisor',
        userId,
      });

      await serverDB.insert(agents).values({
        id: 'regular-agent',
        title: 'Regular Agent',
        userId,
      });

      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'regular-agent',
        chatGroupId: 'no-supervisor-group',
        role: 'participant',
        userId,
      });

      const result = await agentGroupRepo.findByIdWithAgents('no-supervisor-group');

      expect(result).toMatchObject({
        id: 'no-supervisor-group',
        title: 'Group without Supervisor',
      });
      // Supervisor should be auto-created
      expect(result!.supervisorAgentId).toBeDefined();
      // Should have 2 agents: auto-created supervisor + regular agent
      expect(result!.agents).toHaveLength(2);

      // Verify agents include auto-created supervisor
      expect(result!.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            isSupervisor: true,
            title: 'Supervisor',
            virtual: true,
          }),
          expect.objectContaining({
            id: 'regular-agent',
            isSupervisor: false,
            title: 'Regular Agent',
          }),
        ]),
      );

      // Calling again should return the same supervisor (not create another one)
      const result2 = await agentGroupRepo.findByIdWithAgents('no-supervisor-group');
      expect(result2!.supervisorAgentId).toBe(result!.supervisorAgentId);
      expect(result2!.agents).toHaveLength(2);
    });

    it('should auto-create supervisor for group with empty agents', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'empty-agents-group',
        title: 'Empty Agents Group',
        userId,
      });

      const result = await agentGroupRepo.findByIdWithAgents('empty-agents-group');

      expect(result).toMatchObject({
        id: 'empty-agents-group',
        title: 'Empty Agents Group',
      });
      expect(result!.supervisorAgentId).toBeDefined();
      // Only the auto-created supervisor
      expect(result!.agents).toEqual([
        expect.objectContaining({ isSupervisor: true, title: 'Supervisor', virtual: true }),
      ]);
    });

    it('should inject group-supervisor slug for supervisor agent', async () => {
      // Create group
      await serverDB.insert(chatGroups).values({
        id: 'slug-test-group',
        title: 'Slug Test Group',
        userId,
      });

      // Create supervisor and participant agents
      await serverDB.insert(agents).values([
        { id: 'slug-supervisor', slug: null, title: 'Supervisor', userId, virtual: true },
        { id: 'slug-participant', slug: 'custom-slug', title: 'Participant', userId },
      ]);

      // Link agents with roles
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'slug-supervisor',
          chatGroupId: 'slug-test-group',
          order: -1,
          role: 'supervisor',
          userId,
        },
        {
          agentId: 'slug-participant',
          chatGroupId: 'slug-test-group',
          order: 0,
          role: 'participant',
          userId,
        },
      ]);

      const result = await agentGroupRepo.findByIdWithAgents('slug-test-group');

      expect(result).not.toBeNull();
      expect(result!.agents).toHaveLength(2);

      // Verify supervisor has injected slug
      const supervisor = result!.agents.find((a) => a.isSupervisor);
      expect(supervisor).toBeDefined();
      expect(supervisor!.slug).toBe(BUILTIN_AGENT_SLUGS.groupSupervisor);

      // Verify participant keeps original slug
      const participant = result!.agents.find((a) => !a.isSupervisor);
      expect(participant).toBeDefined();
      expect(participant!.slug).toBe('custom-slug');
    });

    it('should inject group-supervisor slug for auto-created supervisor', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'auto-slug-group',
        title: 'Auto Slug Group',
        userId,
      });

      const result = await agentGroupRepo.findByIdWithAgents('auto-slug-group');

      expect(result).not.toBeNull();
      expect(result!.agents).toHaveLength(1);

      // Verify auto-created supervisor has injected slug
      const supervisor = result!.agents[0];
      expect(supervisor.isSupervisor).toBe(true);
      expect(supervisor.slug).toBe(BUILTIN_AGENT_SLUGS.groupSupervisor);
    });
  });

  describe('createGroupWithSupervisor', () => {
    it('should create group with supervisor agent', async () => {
      const result = await agentGroupRepo.createGroupWithSupervisor({
        config: {
          allowDM: true,
          openingMessage: 'Hello team!',
        },
        title: 'New Group with Supervisor',
      });

      expect(result).toMatchObject({
        group: expect.objectContaining({ title: 'New Group with Supervisor' }),
      });
      expect(result.supervisorAgentId).toBeDefined();
      expect(result.agents).toEqual([expect.objectContaining({ role: 'supervisor' })]);

      // Verify supervisor agent was created
      const groupDetail = await agentGroupRepo.findByIdWithAgents(result.group.id);
      expect(groupDetail).toMatchObject({
        supervisorAgentId: result.supervisorAgentId,
      });
      expect(groupDetail!.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: result.supervisorAgentId,
            title: 'Supervisor',
            virtual: true,
          }),
        ]),
      );
    });

    it('should create group with supervisor and member agents', async () => {
      // Create member agents first
      await serverDB.insert(agents).values([
        { id: 'member-1', title: 'Member 1', userId },
        { id: 'member-2', title: 'Member 2', userId },
      ]);

      const result = await agentGroupRepo.createGroupWithSupervisor(
        { title: 'Group with Members' },
        ['member-1', 'member-2'],
      );

      expect(result).toMatchObject({
        group: expect.objectContaining({ title: 'Group with Members' }),
      });
      expect(result.supervisorAgentId).toBeDefined();
      // 1 supervisor + 2 members
      expect(result.agents).toHaveLength(3);

      // Check roles and order
      expect(result.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ order: -1, role: 'supervisor' }),
          expect.objectContaining({ agentId: 'member-1', order: 0, role: 'participant' }),
          expect.objectContaining({ agentId: 'member-2', order: 1, role: 'participant' }),
        ]),
      );
    });

    it('should use custom supervisor config when provided', async () => {
      const result = await agentGroupRepo.createGroupWithSupervisor(
        { title: 'Custom Supervisor Group' },
        [],
        {
          model: 'claude-3-opus',
          provider: 'anthropic',
          title: 'Custom Host',
        },
      );

      const groupDetail = await agentGroupRepo.findByIdWithAgents(result.group.id);
      expect(groupDetail!.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: result.supervisorAgentId,
            model: 'claude-3-opus',
            provider: 'anthropic',
            title: 'Custom Host',
          }),
        ]),
      );
    });

    it('should create group with empty member agents', async () => {
      const result = await agentGroupRepo.createGroupWithSupervisor({
        title: 'Supervisor Only Group',
      });

      expect(result).toMatchObject({
        group: expect.objectContaining({ title: 'Supervisor Only Group' }),
      });
      expect(result.supervisorAgentId).toBeDefined();
      // Only supervisor
      expect(result.agents).toEqual([expect.objectContaining({ role: 'supervisor' })]);
    });
  });

  describe('checkAgentsBeforeRemoval', () => {
    beforeEach(async () => {
      // Create a group
      await serverDB.insert(chatGroups).values({
        id: 'check-removal-group',
        title: 'Check Removal Group',
        userId,
      });

      // Create virtual and non-virtual agents
      await serverDB.insert(agents).values([
        {
          avatar: 'virtual-avatar.png',
          description: 'Virtual agent description',
          id: 'virtual-agent',
          title: 'Virtual Agent',
          userId,
          virtual: true,
        },
        {
          avatar: 'regular-avatar.png',
          description: 'Regular agent description',
          id: 'regular-agent',
          title: 'Regular Agent',
          userId,
          virtual: false,
        },
        {
          id: 'another-regular',
          title: 'Another Regular',
          userId,
          virtual: false,
        },
      ]);

      // Link agents to group
      await serverDB.insert(chatGroupsAgents).values([
        { agentId: 'virtual-agent', chatGroupId: 'check-removal-group', order: 0, userId },
        { agentId: 'regular-agent', chatGroupId: 'check-removal-group', order: 1, userId },
        { agentId: 'another-regular', chatGroupId: 'check-removal-group', order: 2, userId },
      ]);
    });

    it('should separate virtual and non-virtual agents', async () => {
      const result = await agentGroupRepo.checkAgentsBeforeRemoval('check-removal-group', [
        'virtual-agent',
        'regular-agent',
        'another-regular',
      ]);

      expect(result.virtualAgents).toHaveLength(1);
      expect(result.virtualAgents).toEqual([
        expect.objectContaining({
          avatar: 'virtual-avatar.png',
          description: 'Virtual agent description',
          id: 'virtual-agent',
          title: 'Virtual Agent',
        }),
      ]);

      expect(result.nonVirtualAgentIds).toHaveLength(2);
      expect(result.nonVirtualAgentIds).toEqual(
        expect.arrayContaining(['regular-agent', 'another-regular']),
      );
    });

    it('should return empty arrays for empty input', async () => {
      const result = await agentGroupRepo.checkAgentsBeforeRemoval('check-removal-group', []);

      expect(result.virtualAgents).toEqual([]);
      expect(result.nonVirtualAgentIds).toEqual([]);
    });

    it('should only return virtual agents when all are virtual', async () => {
      const result = await agentGroupRepo.checkAgentsBeforeRemoval('check-removal-group', [
        'virtual-agent',
      ]);

      expect(result.virtualAgents).toHaveLength(1);
      expect(result.virtualAgents[0].id).toBe('virtual-agent');
      expect(result.nonVirtualAgentIds).toEqual([]);
    });

    it('should only return non-virtual agents when none are virtual', async () => {
      const result = await agentGroupRepo.checkAgentsBeforeRemoval('check-removal-group', [
        'regular-agent',
        'another-regular',
      ]);

      expect(result.virtualAgents).toEqual([]);
      expect(result.nonVirtualAgentIds).toEqual(
        expect.arrayContaining(['regular-agent', 'another-regular']),
      );
    });

    it('should not include agents belonging to other users', async () => {
      // Create agent for other user
      await serverDB.insert(agents).values({
        id: 'other-user-agent',
        title: 'Other User Agent',
        userId: otherUserId,
        virtual: true,
      });

      const result = await agentGroupRepo.checkAgentsBeforeRemoval('check-removal-group', [
        'virtual-agent',
        'other-user-agent',
      ]);

      // Should only include current user's virtual agent
      expect(result.virtualAgents).toHaveLength(1);
      expect(result.virtualAgents[0].id).toBe('virtual-agent');
      expect(result.nonVirtualAgentIds).toEqual([]);
    });
  });

  describe('removeAgentsFromGroup', () => {
    beforeEach(async () => {
      // Create a group
      await serverDB.insert(chatGroups).values({
        id: 'remove-group',
        title: 'Remove Group',
        userId,
      });

      // Create virtual and non-virtual agents
      await serverDB.insert(agents).values([
        { id: 'remove-virtual', title: 'Virtual to Remove', userId, virtual: true },
        { id: 'remove-regular', title: 'Regular to Remove', userId, virtual: false },
        { id: 'keep-agent', title: 'Keep Agent', userId, virtual: false },
      ]);

      // Link agents to group
      await serverDB.insert(chatGroupsAgents).values([
        { agentId: 'remove-virtual', chatGroupId: 'remove-group', order: 0, userId },
        { agentId: 'remove-regular', chatGroupId: 'remove-group', order: 1, userId },
        { agentId: 'keep-agent', chatGroupId: 'remove-group', order: 2, userId },
      ]);
    });

    it('should remove agents from group and delete virtual agents', async () => {
      const result = await agentGroupRepo.removeAgentsFromGroup('remove-group', [
        'remove-virtual',
        'remove-regular',
      ]);

      expect(result.removedFromGroup).toBe(2);
      expect(result.deletedVirtualAgentIds).toEqual(['remove-virtual']);

      // Verify agents were removed from group
      const groupAgents = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, 'remove-group'),
      });
      expect(groupAgents).toHaveLength(1);
      expect(groupAgents[0].agentId).toBe('keep-agent');

      // Verify virtual agent was deleted
      const deletedVirtual = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'remove-virtual'),
      });
      expect(deletedVirtual).toBeUndefined();

      // Verify regular agent still exists (just removed from group)
      const regularAgent = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'remove-regular'),
      });
      expect(regularAgent).toBeDefined();
    });

    it('should not delete virtual agents when deleteVirtualAgents is false', async () => {
      const result = await agentGroupRepo.removeAgentsFromGroup(
        'remove-group',
        ['remove-virtual'],
        false,
      );

      expect(result.removedFromGroup).toBe(1);
      expect(result.deletedVirtualAgentIds).toEqual([]);

      // Verify virtual agent still exists
      const virtualAgent = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'remove-virtual'),
      });
      expect(virtualAgent).toBeDefined();
    });

    it('should return empty result for empty input', async () => {
      const result = await agentGroupRepo.removeAgentsFromGroup('remove-group', []);

      expect(result.removedFromGroup).toBe(0);
      expect(result.deletedVirtualAgentIds).toEqual([]);
    });

    it('should remove only non-virtual agents correctly', async () => {
      const result = await agentGroupRepo.removeAgentsFromGroup('remove-group', ['remove-regular']);

      expect(result.removedFromGroup).toBe(1);
      expect(result.deletedVirtualAgentIds).toEqual([]);

      // Verify agent was removed from group
      const groupAgents = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, 'remove-group'),
      });
      expect(groupAgents).toHaveLength(2);
      expect(groupAgents.map((g) => g.agentId)).not.toContain('remove-regular');

      // Verify agent still exists
      const agent = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'remove-regular'),
      });
      expect(agent).toBeDefined();
    });

    it('should not remove agents from another user’s group (IDOR)', async () => {
      // Attacker scoped to a different user targets the victim's group + agents.
      const attackerRepo = new AgentGroupRepository(serverDB, otherUserId);

      const result = await attackerRepo.removeAgentsFromGroup('remove-group', [
        'remove-virtual',
        'remove-regular',
      ]);

      // Nothing removed: junction rows belong to the victim, not the attacker.
      expect(result.removedFromGroup).toBe(0);
      expect(result.deletedVirtualAgentIds).toEqual([]);

      // Victim's group membership is untouched.
      const groupAgents = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, 'remove-group'),
      });
      expect(groupAgents).toHaveLength(3);

      // Victim's virtual agent is not deleted.
      const virtualAgent = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'remove-virtual'),
      });
      expect(virtualAgent).toBeDefined();
    });

    it('should handle multiple virtual agents', async () => {
      // Add another virtual agent
      await serverDB.insert(agents).values({
        id: 'remove-virtual-2',
        title: 'Virtual 2 to Remove',
        userId,
        virtual: true,
      });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'remove-virtual-2',
        chatGroupId: 'remove-group',
        order: 3,
        userId,
      });

      const result = await agentGroupRepo.removeAgentsFromGroup('remove-group', [
        'remove-virtual',
        'remove-virtual-2',
      ]);

      expect(result.removedFromGroup).toBe(2);
      expect(result.deletedVirtualAgentIds).toEqual(
        expect.arrayContaining(['remove-virtual', 'remove-virtual-2']),
      );

      // Verify both virtual agents were deleted
      const virtualAgents = await serverDB.query.agents.findMany({
        where: (a, { and, eq, inArray }) =>
          and(eq(a.userId, userId), inArray(a.id, ['remove-virtual', 'remove-virtual-2'])),
      });
      expect(virtualAgents).toHaveLength(0);
    });
  });

  describe('duplicate', () => {
    it('should duplicate a group with all config fields', async () => {
      // Create source group with full config
      await serverDB.insert(chatGroups).values({
        config: {
          allowDM: true,
          openingMessage: 'Welcome!',
          openingQuestions: ['How can I help?'],
          revealDM: false,
          systemPrompt: 'You are a helpful assistant.',
        },
        id: 'source-group',
        pinned: true,
        title: 'Source Group',
        userId,
      });

      // Create supervisor agent
      await serverDB.insert(agents).values({
        id: 'source-supervisor',
        model: 'gpt-4o',
        provider: 'openai',
        title: 'Supervisor',
        userId,
        virtual: true,
      });

      // Link supervisor to group
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'source-supervisor',
        chatGroupId: 'source-group',
        order: -1,
        role: 'supervisor',
        userId,
      });

      const result = await agentGroupRepo.duplicate('source-group');

      expect(result).not.toBeNull();
      expect(result!.groupId).toBeDefined();
      expect(result!.supervisorAgentId).toBeDefined();
      expect(result!.groupId).not.toBe('source-group');
      expect(result!.supervisorAgentId).not.toBe('source-supervisor');

      // Verify duplicated group has correct config
      const duplicatedGroup = await serverDB.query.chatGroups.findFirst({
        where: (cg, { eq }) => eq(cg.id, result!.groupId),
      });

      expect(duplicatedGroup).toEqual(
        expect.objectContaining({
          config: {
            allowDM: true,
            openingMessage: 'Welcome!',
            openingQuestions: ['How can I help?'],
            revealDM: false,
            systemPrompt: 'You are a helpful assistant.',
          },
          pinned: true,
          title: 'Source Group (Copy)',
          userId,
        }),
      );
    });

    it('should duplicate group with custom title', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'title-group',
        title: 'Original Title',
        userId,
      });

      await serverDB.insert(agents).values({
        id: 'title-supervisor',
        title: 'Supervisor',
        userId,
        virtual: true,
      });

      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'title-supervisor',
        chatGroupId: 'title-group',
        order: -1,
        role: 'supervisor',
        userId,
      });

      const result = await agentGroupRepo.duplicate('title-group', 'Custom New Title');

      expect(result).not.toBeNull();

      const duplicatedGroup = await serverDB.query.chatGroups.findFirst({
        where: (cg, { eq }) => eq(cg.id, result!.groupId),
      });

      expect(duplicatedGroup!.title).toBe('Custom New Title');
    });

    it('should copy virtual member agents (create new agents)', async () => {
      // Create source group
      await serverDB.insert(chatGroups).values({
        id: 'virtual-member-group',
        title: 'Virtual Member Group',
        userId,
      });

      // Create supervisor and virtual member agents
      await serverDB.insert(agents).values([
        {
          id: 'vm-supervisor',
          title: 'Supervisor',
          userId,
          virtual: true,
        },
        {
          avatar: 'virtual-avatar.png',
          backgroundColor: '#ff0000',
          description: 'Virtual member description',
          id: 'vm-virtual-member',
          model: 'gpt-4',
          provider: 'openai',
          systemRole: 'You are a virtual assistant',
          tags: ['tag1', 'tag2'],
          title: 'Virtual Member',
          userId,
          virtual: true,
        },
      ]);

      // Link agents to group
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'vm-supervisor',
          chatGroupId: 'virtual-member-group',
          order: -1,
          role: 'supervisor',
          userId,
        },
        {
          agentId: 'vm-virtual-member',
          chatGroupId: 'virtual-member-group',
          enabled: true,
          order: 0,
          role: 'participant',
          userId,
        },
      ]);

      const result = await agentGroupRepo.duplicate('virtual-member-group');

      expect(result).not.toBeNull();

      // Verify new group has agents
      const groupAgents = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, result!.groupId),
      });

      // 1 supervisor + 1 virtual member
      expect(groupAgents).toHaveLength(2);

      // Verify virtual member agent was copied (new agent created)
      const virtualMemberRelation = groupAgents.find(
        (ga) => ga.role === 'participant' && ga.agentId !== 'vm-virtual-member',
      );
      expect(virtualMemberRelation).toBeDefined();

      // Verify copied agent has all fields
      const copiedAgent = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, virtualMemberRelation!.agentId),
      });

      expect(copiedAgent).toEqual(
        expect.objectContaining({
          avatar: 'virtual-avatar.png',
          backgroundColor: '#ff0000',
          description: 'Virtual member description',
          model: 'gpt-4',
          provider: 'openai',
          systemRole: 'You are a virtual assistant',
          tags: ['tag1', 'tag2'],
          title: 'Virtual Member',
          userId,
          virtual: true,
        }),
      );

      // Verify original virtual member still exists
      const originalAgent = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'vm-virtual-member'),
      });
      expect(originalAgent).toBeDefined();
    });

    it('should reference non-virtual member agents (only add relationship)', async () => {
      // Create source group
      await serverDB.insert(chatGroups).values({
        id: 'nonvirtual-member-group',
        title: 'Non-Virtual Member Group',
        userId,
      });

      // Create supervisor and non-virtual member agents
      await serverDB.insert(agents).values([
        {
          id: 'nvm-supervisor',
          title: 'Supervisor',
          userId,
          virtual: true,
        },
        {
          description: 'Regular agent description',
          id: 'nvm-regular-member',
          model: 'claude-3-opus',
          provider: 'anthropic',
          title: 'Regular Member',
          userId,
          virtual: false,
        },
      ]);

      // Link agents to group
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'nvm-supervisor',
          chatGroupId: 'nonvirtual-member-group',
          order: -1,
          role: 'supervisor',
          userId,
        },
        {
          agentId: 'nvm-regular-member',
          chatGroupId: 'nonvirtual-member-group',
          enabled: true,
          order: 0,
          role: 'participant',
          userId,
        },
      ]);

      const result = await agentGroupRepo.duplicate('nonvirtual-member-group');

      expect(result).not.toBeNull();

      // Verify new group has agents
      const groupAgents = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, result!.groupId),
      });

      // 1 supervisor + 1 non-virtual member
      expect(groupAgents).toHaveLength(2);

      // Verify non-virtual member uses the SAME agent ID (just added relationship)
      const regularMemberRelation = groupAgents.find((ga) => ga.agentId === 'nvm-regular-member');
      expect(regularMemberRelation).toBeDefined();
      expect(regularMemberRelation!.role).toBe('participant');
      expect(regularMemberRelation!.enabled).toBe(true);

      // Verify no new agent was created for the regular member
      const allAgentsWithTitle = await serverDB.query.agents.findMany({
        where: (a, { and, eq }) => and(eq(a.userId, userId), eq(a.title, 'Regular Member')),
      });
      // Should only have the original one
      expect(allAgentsWithTitle).toHaveLength(1);
      expect(allAgentsWithTitle[0].id).toBe('nvm-regular-member');
    });

    it('should handle mixed virtual and non-virtual members', async () => {
      // Create source group
      await serverDB.insert(chatGroups).values({
        id: 'mixed-member-group',
        title: 'Mixed Member Group',
        userId,
      });

      // Create supervisor, virtual member, and non-virtual member agents
      await serverDB.insert(agents).values([
        { id: 'mixed-supervisor', title: 'Supervisor', userId, virtual: true },
        { id: 'mixed-virtual', title: 'Virtual Agent', userId, virtual: true },
        { id: 'mixed-regular', title: 'Regular Agent', userId, virtual: false },
      ]);

      // Link agents to group
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'mixed-supervisor',
          chatGroupId: 'mixed-member-group',
          order: -1,
          role: 'supervisor',
          userId,
        },
        {
          agentId: 'mixed-virtual',
          chatGroupId: 'mixed-member-group',
          order: 0,
          role: 'participant',
          userId,
        },
        {
          agentId: 'mixed-regular',
          chatGroupId: 'mixed-member-group',
          order: 1,
          role: 'participant',
          userId,
        },
      ]);

      const result = await agentGroupRepo.duplicate('mixed-member-group');

      expect(result).not.toBeNull();

      const groupAgents = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, result!.groupId),
      });

      // 1 supervisor + 1 virtual (copied) + 1 non-virtual (referenced)
      expect(groupAgents).toHaveLength(3);

      // Verify non-virtual member references original agent
      const regularRelation = groupAgents.find((ga) => ga.agentId === 'mixed-regular');
      expect(regularRelation).toBeDefined();

      // Verify virtual member was copied (new agent ID)
      const virtualRelation = groupAgents.find(
        (ga) => ga.role === 'participant' && ga.agentId !== 'mixed-regular',
      );
      expect(virtualRelation).toBeDefined();
      expect(virtualRelation!.agentId).not.toBe('mixed-virtual');
    });

    it('should return null for non-existent group', async () => {
      const result = await agentGroupRepo.duplicate('non-existent-group');

      expect(result).toBeNull();
    });

    it('should not duplicate group belonging to another user', async () => {
      // Create group for other user
      await serverDB.insert(chatGroups).values({
        id: 'other-user-dup-group',
        title: 'Other User Group',
        userId: otherUserId,
      });

      const result = await agentGroupRepo.duplicate('other-user-dup-group');

      expect(result).toBeNull();
    });

    it('should preserve member order in duplicated group', async () => {
      // Create source group
      await serverDB.insert(chatGroups).values({
        id: 'order-group',
        title: 'Order Group',
        userId,
      });

      // Create agents
      await serverDB.insert(agents).values([
        { id: 'order-supervisor', title: 'Supervisor', userId, virtual: true },
        { id: 'order-agent-1', title: 'Agent 1', userId, virtual: false },
        { id: 'order-agent-2', title: 'Agent 2', userId, virtual: false },
        { id: 'order-agent-3', title: 'Agent 3', userId, virtual: false },
      ]);

      // Link agents with specific order
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'order-supervisor',
          chatGroupId: 'order-group',
          order: -1,
          role: 'supervisor',
          userId,
        },
        {
          agentId: 'order-agent-1',
          chatGroupId: 'order-group',
          order: 2,
          role: 'participant',
          userId,
        },
        {
          agentId: 'order-agent-2',
          chatGroupId: 'order-group',
          order: 0,
          role: 'participant',
          userId,
        },
        {
          agentId: 'order-agent-3',
          chatGroupId: 'order-group',
          order: 1,
          role: 'participant',
          userId,
        },
      ]);

      const result = await agentGroupRepo.duplicate('order-group');

      expect(result).not.toBeNull();

      const groupAgents = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, result!.groupId),
      });

      // Verify order is preserved
      const supervisorRelation = groupAgents.find((ga) => ga.role === 'supervisor');
      expect(supervisorRelation!.order).toBe(-1);

      const agent1Relation = groupAgents.find((ga) => ga.agentId === 'order-agent-1');
      expect(agent1Relation!.order).toBe(2);

      const agent2Relation = groupAgents.find((ga) => ga.agentId === 'order-agent-2');
      expect(agent2Relation!.order).toBe(0);

      const agent3Relation = groupAgents.find((ga) => ga.agentId === 'order-agent-3');
      expect(agent3Relation!.order).toBe(1);
    });

    it('should duplicate group with default title when source has no title', async () => {
      // Create source group without title
      await serverDB.insert(chatGroups).values({
        id: 'no-title-group',
        title: null,
        userId,
      });

      await serverDB.insert(agents).values({
        id: 'no-title-supervisor',
        title: 'Supervisor',
        userId,
        virtual: true,
      });

      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'no-title-supervisor',
        chatGroupId: 'no-title-group',
        order: -1,
        role: 'supervisor',
        userId,
      });

      const result = await agentGroupRepo.duplicate('no-title-group');

      expect(result).not.toBeNull();

      const duplicatedGroup = await serverDB.query.chatGroups.findFirst({
        where: (cg, { eq }) => eq(cg.id, result!.groupId),
      });

      expect(duplicatedGroup!.title).toBe('Copy');
    });

    it('should create new supervisor agent with source supervisor config', async () => {
      // Create source group
      await serverDB.insert(chatGroups).values({
        id: 'supervisor-config-group',
        title: 'Supervisor Config Group',
        userId,
      });

      // Create supervisor with specific config
      await serverDB.insert(agents).values({
        id: 'source-supervisor-with-config',
        model: 'claude-3-opus',
        provider: 'anthropic',
        title: 'Custom Supervisor',
        userId,
        virtual: true,
      });

      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'source-supervisor-with-config',
        chatGroupId: 'supervisor-config-group',
        order: -1,
        role: 'supervisor',
        userId,
      });

      const result = await agentGroupRepo.duplicate('supervisor-config-group');

      expect(result).not.toBeNull();

      // Verify new supervisor has same config
      const newSupervisor = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, result!.supervisorAgentId),
      });

      expect(newSupervisor).toEqual(
        expect.objectContaining({
          model: 'claude-3-opus',
          provider: 'anthropic',
          title: 'Custom Supervisor',
          virtual: true,
        }),
      );
    });
  });

  describe('workspace scoping', () => {
    const workspaceId = 'agent-group-test-ws';

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Test Workspace',
        primaryOwnerId: userId,
        slug: 'agent-group-test-ws',
      });
    });

    it('stamps workspaceId on the group, supervisor agent, and junction rows', async () => {
      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);

      const result = await wsRepo.createGroupWithSupervisor({ title: 'WS Group' });

      // group row carries the workspace id
      expect(result.group.workspaceId).toBe(workspaceId);

      // supervisor agent carries the workspace id
      const supervisor = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, result.supervisorAgentId),
      });
      expect(supervisor!.workspaceId).toBe(workspaceId);

      // junction rows carry the workspace id
      const junctions = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, result.group.id),
      });
      expect(junctions.every((j) => j.workspaceId === workspaceId)).toBe(true);
    });

    // Regression for "群组设定 system prompt won't save": a group created inside a
    // workspace must be updatable through the workspace-scoped ChatGroupModel.
    // Previously create wrote workspace_id = NULL, so the workspace-scoped UPDATE
    // matched 0 rows and threw "not found or access denied".
    it('allows the workspace-scoped ChatGroupModel to update a workspace-created group', async () => {
      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const { group } = await wsRepo.createGroupWithSupervisor({ title: 'WS Group' });

      const chatGroupModel = new ChatGroupModel(serverDB, userId, workspaceId);

      const updated = await chatGroupModel.update(group.id, {
        config: { systemPrompt: 'You are a helpful team.' } as any,
      });

      expect(updated.config).toMatchObject({ systemPrompt: 'You are a helpful team.' });
    });

    it('isolates workspace groups from personal-mode reads', async () => {
      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const { group } = await wsRepo.createGroupWithSupervisor({ title: 'WS Group' });

      // personal-mode repo (no workspaceId) must not see the workspace group
      const personalRepo = new AgentGroupRepository(serverDB, userId);
      expect(await personalRepo.findByIdWithAgents(group.id)).toBeNull();

      // workspace repo sees it
      expect(await wsRepo.findByIdWithAgents(group.id)).not.toBeNull();
    });

    it('keeps personal groups out of workspace-scoped reads', async () => {
      const personalRepo = new AgentGroupRepository(serverDB, userId);
      const { group } = await personalRepo.createGroupWithSupervisor({ title: 'Personal Group' });

      expect(group.workspaceId).toBeNull();

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      expect(await wsRepo.findByIdWithAgents(group.id)).toBeNull();
    });

    it('transfers a workspace group with members and conversation data to the target scope', async () => {
      const targetWorkspaceId = 'agent-group-target-ws';
      await serverDB.insert(workspaces).values({
        id: targetWorkspaceId,
        name: 'Target Workspace',
        primaryOwnerId: userId,
        slug: 'agent-group-target-ws',
      });

      await serverDB.insert(chatGroups).values({
        id: 'transfer-group',
        title: 'Transfer Group',
        userId,
        workspaceId,
      });
      await serverDB.insert(agents).values([
        {
          id: 'transfer-supervisor',
          title: 'Supervisor',
          userId,
          virtual: true,
          workspaceId,
        },
        {
          id: 'transfer-member',
          title: 'Member',
          userId,
          virtual: false,
          workspaceId,
        },
      ]);
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'transfer-supervisor',
          chatGroupId: 'transfer-group',
          order: -1,
          role: 'supervisor',
          userId,
          workspaceId,
        },
        {
          agentId: 'transfer-member',
          chatGroupId: 'transfer-group',
          order: 0,
          role: 'participant',
          userId,
          workspaceId,
        },
      ]);
      await serverDB.insert(topics).values({
        groupId: 'transfer-group',
        id: 'transfer-topic',
        title: 'Group Topic',
        userId,
        workspaceId,
      });
      await serverDB.insert(threads).values({
        agentId: 'transfer-member',
        id: 'transfer-thread',
        topicId: 'transfer-topic',
        type: 'continuation',
        userId,
        workspaceId,
      });
      await serverDB.insert(messages).values({
        content: 'hello',
        groupId: 'transfer-group',
        id: 'transfer-message',
        role: 'user',
        topicId: 'transfer-topic',
        userId,
        workspaceId,
      });

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const result = await wsRepo.transferToWorkspace('transfer-group', targetWorkspaceId, userId);

      expect(result).toEqual({ groupId: 'transfer-group' });

      const group = await serverDB.query.chatGroups.findFirst({
        where: (cg, { eq }) => eq(cg.id, 'transfer-group'),
      });
      expect(group!.workspaceId).toBe(targetWorkspaceId);

      const memberAgents = await serverDB.query.agents.findMany({
        where: (a, { inArray }) => inArray(a.id, ['transfer-supervisor', 'transfer-member']),
      });
      expect(memberAgents.every((agent) => agent.workspaceId === targetWorkspaceId)).toBe(true);

      const junctions = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, 'transfer-group'),
      });
      expect(junctions.every((junction) => junction.workspaceId === targetWorkspaceId)).toBe(true);

      const topic = await serverDB.query.topics.findFirst({
        where: (t, { eq }) => eq(t.id, 'transfer-topic'),
      });
      const thread = await serverDB.query.threads.findFirst({
        where: (t, { eq }) => eq(t.id, 'transfer-thread'),
      });
      const message = await serverDB.query.messages.findFirst({
        where: (m, { eq }) => eq(m.id, 'transfer-message'),
      });
      expect(topic!.workspaceId).toBe(targetWorkspaceId);
      expect(thread!.workspaceId).toBe(targetWorkspaceId);
      expect(message!.workspaceId).toBe(targetWorkspaceId);
    });

    it('copies a workspace group and all members into the target scope', async () => {
      const targetWorkspaceId = 'agent-group-copy-target-ws';
      await serverDB.insert(workspaces).values({
        id: targetWorkspaceId,
        name: 'Copy Target Workspace',
        primaryOwnerId: userId,
        slug: 'agent-group-copy-target-ws',
      });

      await serverDB.insert(chatGroups).values({
        avatar: 'group-avatar',
        id: 'copy-group',
        title: 'Copy Group',
        userId,
        workspaceId,
      });
      await serverDB.insert(agents).values([
        {
          id: 'copy-supervisor',
          model: 'gpt-4o',
          provider: 'openai',
          title: 'Supervisor',
          userId,
          virtual: true,
          workspaceId,
        },
        {
          id: 'copy-member',
          model: 'claude-3',
          provider: 'anthropic',
          title: 'Member',
          userId,
          virtual: false,
          workspaceId,
        },
      ]);
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'copy-supervisor',
          chatGroupId: 'copy-group',
          order: -1,
          role: 'supervisor',
          userId,
          workspaceId,
        },
        {
          agentId: 'copy-member',
          chatGroupId: 'copy-group',
          order: 0,
          role: 'participant',
          userId,
          workspaceId,
        },
      ]);

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const result = await wsRepo.copyToWorkspace('copy-group', targetWorkspaceId, userId);

      expect(result).not.toBeNull();
      expect(result!.groupId).not.toBe('copy-group');
      expect(result!.supervisorAgentId).not.toBe('copy-supervisor');

      const copiedGroup = await serverDB.query.chatGroups.findFirst({
        where: (cg, { eq }) => eq(cg.id, result!.groupId),
      });
      expect(copiedGroup).toEqual(
        expect.objectContaining({
          avatar: 'group-avatar',
          title: 'Copy Group (Copy)',
          userId,
          workspaceId: targetWorkspaceId,
        }),
      );

      const copiedJunctions = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, result!.groupId),
      });
      expect(copiedJunctions).toHaveLength(2);
      expect(copiedJunctions.every((junction) => junction.workspaceId === targetWorkspaceId)).toBe(
        true,
      );
      expect(copiedJunctions.some((junction) => junction.agentId === 'copy-member')).toBe(false);

      const copiedAgentIds = copiedJunctions.map((junction) => junction.agentId);
      const copiedAgents = await serverDB.query.agents.findMany({
        where: (a, { inArray }) => inArray(a.id, copiedAgentIds),
      });
      expect(copiedAgents.every((agent) => agent.workspaceId === targetWorkspaceId)).toBe(true);
      expect(copiedAgents.map((agent) => agent.title).sort()).toEqual(['Member', 'Supervisor']);
    });

    it('copies group topics and messages when conversation history is selected', async () => {
      const targetWorkspaceId = 'agent-group-copy-history-target-ws';
      await serverDB.insert(workspaces).values({
        id: targetWorkspaceId,
        name: 'Copy History Target Workspace',
        primaryOwnerId: userId,
        slug: 'agent-group-copy-history-target-ws',
      });

      await serverDB.insert(chatGroups).values({
        id: 'copy-history-group',
        title: 'Copy History Group',
        userId,
        workspaceId,
      });
      await serverDB.insert(agents).values([
        {
          id: 'copy-history-supervisor',
          model: 'gpt-4o',
          provider: 'openai',
          title: 'Supervisor',
          userId,
          virtual: true,
          workspaceId,
        },
        {
          id: 'copy-history-member',
          model: 'claude-3',
          provider: 'anthropic',
          title: 'Member',
          userId,
          virtual: false,
          workspaceId,
        },
      ]);
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'copy-history-supervisor',
          chatGroupId: 'copy-history-group',
          order: -1,
          role: 'supervisor',
          userId,
          workspaceId,
        },
        {
          agentId: 'copy-history-member',
          chatGroupId: 'copy-history-group',
          order: 0,
          role: 'participant',
          userId,
          workspaceId,
        },
      ]);
      await serverDB.insert(topics).values({
        groupId: 'copy-history-group',
        id: 'copy-history-topic',
        title: 'Group topic',
        userId,
        workspaceId,
      });
      await serverDB.insert(threads).values({
        agentId: 'copy-history-member',
        groupId: 'copy-history-group',
        id: 'copy-history-thread',
        sourceMessageId: 'copy-history-message-user',
        topicId: 'copy-history-topic',
        type: 'standalone',
        userId,
        workspaceId,
      });
      await serverDB.insert(messages).values([
        {
          content: 'Hello group',
          groupId: 'copy-history-group',
          id: 'copy-history-message-user',
          role: 'user',
          targetId: 'copy-history-member',
          topicId: 'copy-history-topic',
          userId,
          workspaceId,
        },
        {
          agentId: 'copy-history-member',
          content: 'Hello user',
          groupId: 'copy-history-group',
          id: 'copy-history-message-assistant',
          parentId: 'copy-history-message-user',
          role: 'assistant',
          threadId: 'copy-history-thread',
          tools: [{ id: 'toolu_old', type: 'builtin' }],
          topicId: 'copy-history-topic',
          userId,
          workspaceId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        apiName: 'search',
        arguments: '{}',
        id: 'copy-history-message-assistant',
        toolCallId: 'toolu_old',
        userId,
        workspaceId,
      });

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const result = await wsRepo.copyToWorkspace('copy-history-group', targetWorkspaceId, userId, {
        includeConversationHistory: true,
      });

      expect(result).not.toBeNull();

      const copiedJunctions = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, result!.groupId),
      });
      const copiedMember = copiedJunctions.find((junction) => junction.role === 'participant');
      expect(copiedMember?.agentId).toBeDefined();
      expect(copiedMember?.agentId).not.toBe('copy-history-member');

      const copiedTopics = await serverDB.query.topics.findMany({
        where: (topic, { eq }) => eq(topic.groupId, result!.groupId),
      });
      expect(copiedTopics).toHaveLength(1);
      expect(copiedTopics[0]).toEqual(
        expect.objectContaining({
          clientId: null,
          sessionId: null,
          title: 'Group topic',
          userId,
          workspaceId: targetWorkspaceId,
        }),
      );

      const copiedMessages = await serverDB.query.messages.findMany({
        where: (message, { eq }) => eq(message.groupId, result!.groupId),
      });
      expect(copiedMessages).toHaveLength(2);
      expect(copiedMessages.some((message) => message.id === 'copy-history-message-user')).toBe(
        false,
      );

      const copiedAssistantMessage = copiedMessages.find((message) => message.role === 'assistant');
      const copiedUserMessage = copiedMessages.find((message) => message.role === 'user');
      expect(copiedUserMessage?.targetId).toBe(copiedMember!.agentId);
      expect(copiedAssistantMessage).toEqual(
        expect.objectContaining({
          agentId: copiedMember!.agentId,
          clientId: null,
          targetId: null,
          userId,
          workspaceId: targetWorkspaceId,
        }),
      );
      expect(copiedAssistantMessage?.tools).not.toEqual([{ id: 'toolu_old', type: 'builtin' }]);

      const copiedPlugin = await serverDB.query.messagePlugins.findFirst({
        where: (plugin, { eq }) => eq(plugin.id, copiedAssistantMessage!.id),
      });
      expect(copiedPlugin?.toolCallId).not.toBe('toolu_old');
      expect(copiedPlugin?.workspaceId).toBe(targetWorkspaceId);
    });

    it('removes workspace virtual agents created by another member', async () => {
      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);

      await serverDB.insert(chatGroups).values({
        id: 'remove-cross-member-group',
        title: 'Remove Cross Member Group',
        userId,
        workspaceId,
      });
      await serverDB.insert(agents).values({
        id: 'remove-cross-member-virtual',
        title: 'Virtual From Other Member',
        userId: otherUserId,
        virtual: true,
        workspaceId,
      });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'remove-cross-member-virtual',
        chatGroupId: 'remove-cross-member-group',
        role: 'participant',
        userId,
        workspaceId,
      });

      const result = await wsRepo.removeAgentsFromGroup('remove-cross-member-group', [
        'remove-cross-member-virtual',
      ]);

      expect(result).toEqual({
        deletedVirtualAgentIds: ['remove-cross-member-virtual'],
        removedFromGroup: 1,
      });

      const relation = await serverDB.query.chatGroupsAgents.findFirst({
        where: (cga, { eq }) => eq(cga.agentId, 'remove-cross-member-virtual'),
      });
      expect(relation).toBeUndefined();

      const deletedAgent = await serverDB.query.agents.findFirst({
        where: (agent, { eq }) => eq(agent.id, 'remove-cross-member-virtual'),
      });
      expect(deletedAgent).toBeUndefined();
    });

    it('copies workspace group history created by another member', async () => {
      const targetWorkspaceId = 'agent-group-copy-member-history-target-ws';
      await serverDB.insert(workspaces).values({
        id: targetWorkspaceId,
        name: 'Copy Member History Target Workspace',
        primaryOwnerId: userId,
        slug: 'agent-group-copy-member-history-target-ws',
      });

      await serverDB.insert(chatGroups).values({
        id: 'copy-member-history-group',
        title: 'Copy Member History Group',
        userId,
        workspaceId,
      });
      await serverDB.insert(agents).values([
        {
          id: 'copy-member-history-supervisor',
          title: 'Supervisor',
          userId,
          virtual: true,
          workspaceId,
        },
        {
          id: 'copy-member-history-agent',
          title: 'Member Agent',
          userId,
          virtual: false,
          workspaceId,
        },
      ]);
      await serverDB.insert(chatGroupsAgents).values([
        {
          agentId: 'copy-member-history-supervisor',
          chatGroupId: 'copy-member-history-group',
          order: -1,
          role: 'supervisor',
          userId,
          workspaceId,
        },
        {
          agentId: 'copy-member-history-agent',
          chatGroupId: 'copy-member-history-group',
          order: 0,
          role: 'participant',
          userId,
          workspaceId,
        },
      ]);
      await serverDB.insert(topics).values({
        groupId: 'copy-member-history-group',
        id: 'copy-member-history-topic',
        title: 'Topic From Other Member',
        userId: otherUserId,
        workspaceId,
      });
      await serverDB.insert(threads).values({
        agentId: 'copy-member-history-agent',
        groupId: 'copy-member-history-group',
        id: 'copy-member-history-thread',
        topicId: 'copy-member-history-topic',
        type: 'standalone',
        userId: otherUserId,
        workspaceId,
      });
      await serverDB.insert(messages).values({
        agentId: 'copy-member-history-agent',
        content: 'created by another workspace member',
        groupId: 'copy-member-history-group',
        id: 'copy-member-history-message',
        role: 'assistant',
        threadId: 'copy-member-history-thread',
        topicId: 'copy-member-history-topic',
        userId: otherUserId,
        workspaceId,
      });

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const result = await wsRepo.copyToWorkspace(
        'copy-member-history-group',
        targetWorkspaceId,
        userId,
        { includeConversationHistory: true },
      );

      expect(result).not.toBeNull();

      const copiedTopics = await serverDB.query.topics.findMany({
        where: (topic, { eq }) => eq(topic.groupId, result!.groupId),
      });
      expect(copiedTopics).toHaveLength(1);
      expect(copiedTopics[0]).toEqual(
        expect.objectContaining({
          title: 'Topic From Other Member',
          userId,
          workspaceId: targetWorkspaceId,
        }),
      );

      const copiedMessages = await serverDB.query.messages.findMany({
        where: (message, { eq }) => eq(message.groupId, result!.groupId),
      });
      expect(copiedMessages).toHaveLength(1);
      expect(copiedMessages[0]).toEqual(
        expect.objectContaining({
          content: 'created by another workspace member',
          userId,
          workspaceId: targetWorkspaceId,
        }),
      );
    });
  });
});
