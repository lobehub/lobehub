// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { AGENT_TRANSFER_IN_PROGRESS } from '../../models/agentTransferJob';
import { ChatGroupModel } from '../../models/chatGroup';
import {
  TOPIC_COMMENT_TOPIC_NOT_FOUND,
  TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS,
  TopicCommentModel,
} from '../../models/topicComment';
import { agents } from '../../schemas/agent';
import { agentHistoryJobAgents, agentHistoryJobs } from '../../schemas/agentHistoryJob';
import { chatGroups, chatGroupsAgents } from '../../schemas/chatGroup';
import { messagePlugins, messages } from '../../schemas/message';
import { threads, topics } from '../../schemas/topic';
import { topicCommentMentions, topicComments } from '../../schemas/topicComment';
import { users } from '../../schemas/user';
import { workspaces } from '../../schemas/workspace';
import type { LobeChatDatabase } from '../../type';
import { AgentGroupRepository, GROUP_HAS_INACCESSIBLE_MEMBER } from './index';

const userId = 'agent-group-test-user';
const otherUserId = 'other-agent-group-user';

let agentGroupRepo: AgentGroupRepository;

const serverDB: LobeChatDatabase = await getTestDB();
const isServerDB = process.env.TEST_SERVER_DB === '1';

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);
  // Jobs deliberately carry no FK onto users, so `delete(users)` leaves them
  // behind. On the shared server DB (`singleFork`) a stray pending job would
  // outlive this file and trip the transfer/removal guards in the next one.
  await serverDB.delete(agentHistoryJobs);
  delete process.env.AGENT_COPY_SYNC_MESSAGE_THRESHOLD;

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize repo
  agentGroupRepo = new AgentGroupRepository(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(agentHistoryJobs);
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

    describe('member agent demoted to private ', () => {
      const workspaceId = 'agent-group-demotion-ws';

      beforeEach(async () => {
        await serverDB.insert(workspaces).values({
          id: workspaceId,
          name: 'Demotion WS',
          primaryOwnerId: userId,
          slug: workspaceId,
        });
        await serverDB.insert(chatGroups).values({
          id: 'ws-demotion-group',
          title: 'WS demotion group',
          userId,
          visibility: 'public',
          workspaceId,
        });
        await serverDB.insert(agents).values([
          {
            id: 'ws-supervisor',
            title: 'Supervisor',
            userId,
            virtual: true,
            visibility: 'public',
            workspaceId,
          },
          {
            id: 'ws-public-member',
            title: 'Public member',
            userId,
            visibility: 'public',
            workspaceId,
          },
          {
            id: 'ws-demoted-member',
            systemRole: 'secret prompt',
            title: 'Demoted member',
            userId,
            visibility: 'private',
            workspaceId,
          },
        ]);
        await serverDB.insert(chatGroupsAgents).values([
          {
            agentId: 'ws-supervisor',
            chatGroupId: 'ws-demotion-group',
            order: -1,
            role: 'supervisor',
            userId,
            workspaceId,
          },
          {
            agentId: 'ws-public-member',
            chatGroupId: 'ws-demotion-group',
            order: 0,
            role: 'participant',
            userId,
            workspaceId,
          },
          {
            agentId: 'ws-demoted-member',
            chatGroupId: 'ws-demotion-group',
            order: 1,
            role: 'participant',
            userId,
            workspaceId,
          },
        ]);
      });

      it('hides the private member config from another workspace member', async () => {
        const viewerRepo = new AgentGroupRepository(serverDB, otherUserId, workspaceId);

        const result = await viewerRepo.findByIdWithAgents('ws-demotion-group');

        expect(result!.agents.map((a) => a.id)).toEqual(['ws-supervisor', 'ws-public-member']);
        expect(JSON.stringify(result)).not.toContain('secret prompt');
        expect(result!.supervisorAgentId).toBe('ws-supervisor');
      });

      it('keeps the private member visible to its owner', async () => {
        const ownerRepo = new AgentGroupRepository(serverDB, userId, workspaceId);

        const result = await ownerRepo.findByIdWithAgents('ws-demotion-group');

        expect(result!.agents.map((a) => a.id)).toEqual([
          'ws-supervisor',
          'ws-public-member',
          'ws-demoted-member',
        ]);
      });

      it('does not auto-create a duplicate supervisor when the supervisor row is not visible', async () => {
        // Out-of-sync legacy data: a group published while its supervisor row
        // stayed private (publishToWorkspace now keeps them in sync).
        await serverDB
          .update(agents)
          .set({ visibility: 'private' })
          .where(eq(agents.id, 'ws-supervisor'));

        const viewerRepo = new AgentGroupRepository(serverDB, otherUserId, workspaceId);
        const result = await viewerRepo.findByIdWithAgents('ws-demotion-group');

        // Supervisor existence is judged on raw rows: no duplicate is created,
        // and the group-owned supervisor stays in the roster so that
        // `supervisorAgentId` always resolves to a member entry.
        expect(result!.supervisorAgentId).toBe('ws-supervisor');
        expect(result!.agents.map((a) => a.id)).toEqual(['ws-supervisor', 'ws-public-member']);

        const supervisorRows = await serverDB
          .select()
          .from(chatGroupsAgents)
          .where(eq(chatGroupsAgents.chatGroupId, 'ws-demotion-group'));
        expect(supervisorRows.filter((r) => r.role === 'supervisor')).toHaveLength(1);
      });
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

    it('refuses to remove a member a pending copy job is still writing into', async () => {
      // The copy junction records the TARGET agent. Deleting that agent now
      // cascades the row the drain is about to reference, so its next message
      // insert violates `messages.agent_id` and the job retries forever —
      // leaving the copied conversations stranded as pending.
      const [job] = await serverDB
        .insert(agentHistoryJobs)
        .values({
          agentIds: ['remove-virtual'],
          payload: { agents: [{ newAgentId: 'remove-virtual', sourceAgentId: 'keep-agent' }] },
          sessionIds: [],
          sourceUserId: userId,
          status: 'pending',
          targetUserId: userId,
          totalTopics: 1,
          type: 'copy',
        })
        .returning({ id: agentHistoryJobs.id });
      await serverDB
        .insert(agentHistoryJobAgents)
        .values({ agentId: 'remove-virtual', jobId: job.id });

      await expect(
        agentGroupRepo.removeAgentsFromGroup('remove-group', ['remove-virtual']),
      ).rejects.toThrow(AGENT_TRANSFER_IN_PROGRESS);

      // Nothing was removed or deleted — the guard aborted the whole transaction.
      const stillLinked = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, 'remove-group'),
      });
      expect(stillLinked).toHaveLength(3);
      const stillAlive = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'remove-virtual'),
      });
      expect(stillAlive).toBeDefined();
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
      const originalCommentUpdatedAt = new Date('2024-01-02T03:04:05.000Z');
      await serverDB.insert(topicComments).values({
        authorUserId: userId,
        clientId: 'transfer-comment-client',
        content: 'team note',
        id: 'transfer-comment',
        topicId: 'transfer-topic',
        updatedAt: originalCommentUpdatedAt,
        workspaceId,
      });
      await serverDB.insert(topicCommentMentions).values({
        commentId: 'transfer-comment',
        mentionedUserId: userId,
        workspaceId,
      });

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const result = await wsRepo.transferToWorkspace('transfer-group', targetWorkspaceId, userId);

      expect(result).toEqual({ groupId: 'transfer-group', transferJobId: null });

      const group = await serverDB.query.chatGroups.findFirst({
        where: (cg, { eq }) => eq(cg.id, 'transfer-group'),
      });
      expect(group!.workspaceId).toBe(targetWorkspaceId);

      // The supervisor is group-owned and travels; `transfer-member` is a
      // standalone agent this group merely referenced, so it stays put and the
      // group takes a copy of it instead.
      const supervisor = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'transfer-supervisor'),
      });
      expect(supervisor!.workspaceId).toBe(targetWorkspaceId);

      const referencedMember = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'transfer-member'),
      });
      expect(referencedMember!.workspaceId).toBe(workspaceId);

      const junctions = await serverDB.query.chatGroupsAgents.findMany({
        where: (cga, { eq }) => eq(cga.chatGroupId, 'transfer-group'),
      });
      expect(junctions.every((junction) => junction.workspaceId === targetWorkspaceId)).toBe(true);
      expect(junctions.some((junction) => junction.agentId === 'transfer-member')).toBe(false);

      const clonedRow = junctions.find((junction) => junction.agentId !== 'transfer-supervisor')!;
      const clone = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, clonedRow.agentId),
      });
      // Hidden from the target's agent list — it exists for this group only.
      expect(clone).toMatchObject({
        title: 'Member',
        virtual: true,
        workspaceId: targetWorkspaceId,
      });

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

      // `threads.agent_id` is ON DELETE CASCADE: left pointing at the member
      // that stayed behind, this moved thread would disappear the day its
      // owner deleted that agent.
      expect(thread!.agentId).toBe(clonedRow.agentId);

      // Comments denormalize the topic's workspaceId — they must follow the move
      const [comment] = await serverDB
        .select()
        .from(topicComments)
        .where(eq(topicComments.id, 'transfer-comment'));
      const [mention] = await serverDB
        .select()
        .from(topicCommentMentions)
        .where(eq(topicCommentMentions.commentId, 'transfer-comment'));
      expect(comment.workspaceId).toBe(targetWorkspaceId);
      expect(comment.updatedAt).toEqual(originalCommentUpdatedAt);
      expect(mention.workspaceId).toBe(targetWorkspaceId);
    });

    it('aborts when the group leaves the source scope before the lock is taken', async () => {
      // The scope check runs outside the transaction. A racing transfer small
      // enough to take the fast path leaves no pending job behind, so the
      // guards cannot catch it — only re-asserting the scope inside the lock
      // can. Simulate that window: the pre-read reports the group as in-scope,
      // but the committed row already belongs to someone else.
      const raceTargetWorkspaceId = 'agent-group-race-ws';
      await serverDB.insert(workspaces).values({
        id: raceTargetWorkspaceId,
        name: 'Race Target Workspace',
        primaryOwnerId: userId,
        slug: 'agent-group-race-ws',
      });
      await serverDB.insert(chatGroups).values({
        id: 'moved-group',
        title: 'Moved Group',
        userId: otherUserId,
      });

      const staleRead = vi
        .spyOn(serverDB.query.chatGroups, 'findFirst')
        .mockResolvedValueOnce({ id: 'moved-group', title: 'Moved Group', userId } as never);

      try {
        const result = await agentGroupRepo.transferToWorkspace(
          'moved-group',
          raceTargetWorkspaceId,
          userId,
        );
        expect(result).toBeNull();
      } finally {
        staleRead.mockRestore();
      }

      // Untouched: no second transfer ran off the stale state.
      const group = await serverDB.query.chatGroups.findFirst({
        where: (cg, { eq }) => eq(cg.id, 'moved-group'),
      });
      expect(group!.userId).toBe(otherUserId);
      expect(group!.workspaceId).toBeNull();
    });

    it('flags teammate-authored comments as foreign transfer rows', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'guard-group',
        title: 'Guard Group',
        userId,
        workspaceId,
      });
      await serverDB.insert(topics).values({
        groupId: 'guard-group',
        id: 'guard-group-topic',
        title: 'Own Topic',
        userId,
        workspaceId,
      });

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);

      // Caller's own comment — not foreign
      await serverDB.insert(topicComments).values({
        authorUserId: userId,
        clientId: 'guard-group-own',
        content: 'my note',
        id: 'tcm-group-guard-own',
        topicId: 'guard-group-topic',
        workspaceId,
      });
      expect(await wsRepo.transferHasForeignRows('guard-group')).toBe(false);

      // A teammate's comment on the caller's own topic — foreign
      await serverDB.insert(topicComments).values({
        authorUserId: otherUserId,
        clientId: 'guard-group-teammate',
        content: 'teammate note',
        id: 'tcm-group-guard-teammate',
        topicId: 'guard-group-topic',
        workspaceId,
      });
      expect(await wsRepo.transferHasForeignRows('guard-group')).toBe(true);
    });

    it.skipIf(!isServerDB)(
      'serializes comment creation with the authoritative group transfer check',
      async () => {
        const targetWorkspaceId = 'agent-group-race-target-ws';
        await serverDB.insert(workspaces).values({
          id: targetWorkspaceId,
          name: 'Race Target Workspace',
          primaryOwnerId: userId,
          slug: targetWorkspaceId,
        });
        const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
        const commenterModel = new TopicCommentModel(serverDB, otherUserId, workspaceId);

        for (let i = 0; i < 10; i++) {
          const groupId = `transfer-group-race-${i}`;
          const topicId = `transfer-group-race-topic-${i}`;
          await serverDB.insert(chatGroups).values({
            id: groupId,
            title: `Race Group ${i}`,
            userId,
            workspaceId,
          });
          await serverDB.insert(topics).values({
            groupId,
            id: topicId,
            title: `Race Topic ${i}`,
            userId,
            workspaceId,
          });

          const outcomes = await Promise.allSettled([
            wsRepo.transferToWorkspace(groupId, targetWorkspaceId, userId, undefined, {
              rejectForeignTopicCommentAuthors: true,
            }),
            commenterModel.createWithMentions({
              clientId: `transfer-group-race-comment-${i}`,
              content: 'concurrent teammate comment',
              topicId,
            }),
          ]);

          expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
          const rejection = outcomes.find(
            (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
          );
          expect([
            TOPIC_COMMENT_TOPIC_NOT_FOUND,
            TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS,
          ]).toContain(rejection?.reason.message);
        }
      },
    );

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

    it('copies a conversation history larger than one insert batch and backfills cross-batch parent references', async () => {
      // Regression: an unchunked INSERT of a large history overflows PostgreSQL's
      // 65,535 bind-parameter cap per statement; chunked inserts must also keep
      // self-referential FKs valid when a reference points into a later batch.
      const targetWorkspaceId = 'agent-group-copy-large-target-ws';
      await serverDB.insert(workspaces).values({
        id: targetWorkspaceId,
        name: 'Copy Large Target Workspace',
        primaryOwnerId: userId,
        slug: 'agent-group-copy-large-target-ws',
      });

      await serverDB.insert(chatGroups).values({
        id: 'copy-large-group',
        title: 'Copy Large Group',
        userId,
        workspaceId,
      });
      await serverDB.insert(agents).values({
        id: 'copy-large-member',
        title: 'Member',
        userId,
        virtual: false,
        workspaceId,
      });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'copy-large-member',
        chatGroupId: 'copy-large-group',
        order: 0,
        role: 'participant',
        userId,
        workspaceId,
      });
      await serverDB.insert(topics).values({
        groupId: 'copy-large-group',
        id: 'copy-large-topic',
        title: 'Large topic',
        userId,
        workspaceId,
      });

      // This case exercises the SYNCHRONOUS copy's batching, so the fast/slow
      // threshold is lifted above the seeded volume — otherwise a history this
      // large would be deferred to a copy job and nothing would be inserted
      // inline (the async path has its own coverage in
      // `__tests__/groupHistoryJob.test.ts`).
      process.env.AGENT_COPY_SYNC_MESSAGE_THRESHOLD = '100000';

      // 2401 rows × 31 `messages` columns ≈ 74k bind parameters — above the
      // 65,535 cap, so the pre-fix unbatched INSERT provably fails here.
      const messageCount = 2401;
      const base = Date.parse('2026-01-01T00:00:00Z');
      const sourceRows = Array.from({ length: messageCount }, (_, i) => ({
        content: `msg ${i}`,
        createdAt: new Date(base + i * 1000),
        groupId: 'copy-large-group',
        id: `copy-large-msg-${String(i).padStart(4, '0')}`,
        // odd rows reply to the previous row; row 0 gets a forward reference
        // (backfilled below) to a row that lands in a LATER insert batch when
        // copying with 500-row batches (index 700 → batch 2)
        parentId: i % 2 === 1 ? `copy-large-msg-${String(i - 1).padStart(4, '0')}` : null,
        role: i % 2 === 0 ? 'user' : 'assistant',
        topicId: 'copy-large-topic',
        // explicit historical stamps so the cross-batch fixup UPDATE would
        // visibly restamp them if it forgot to restate `updatedAt`
        updatedAt: new Date(base + i * 1000),
        userId,
        workspaceId,
      }));
      for (let i = 0; i < sourceRows.length; i += 400) {
        await serverDB.insert(messages).values(sourceRows.slice(i, i + 400));
      }
      await serverDB
        .update(messages)
        // restate updatedAt: this seeding backfill would otherwise restamp the
        // source row via $onUpdate before the copy even runs
        .set({ parentId: 'copy-large-msg-0700', updatedAt: new Date(base) })
        .where(eq(messages.id, 'copy-large-msg-0000'));

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const result = await wsRepo.copyToWorkspace('copy-large-group', targetWorkspaceId, userId, {
        includeConversationHistory: true,
      });

      expect(result).not.toBeNull();

      const copiedMessages = await serverDB.query.messages.findMany({
        where: (message, { eq }) => eq(message.groupId, result!.groupId),
      });
      expect(copiedMessages).toHaveLength(messageCount);
      expect(copiedMessages.every((message) => message.workspaceId === targetWorkspaceId)).toBe(
        true,
      );
      expect(copiedMessages.some((message) => message.id.startsWith('copy-large-msg-'))).toBe(
        false,
      );

      const copiedByContent = new Map(copiedMessages.map((message) => [message.content, message]));
      const copiedIds = new Set(copiedMessages.map((message) => message.id));

      // the deferred fixup UPDATE restated `updatedAt` instead of letting
      // `$onUpdate` restamp the cross-batch row to "now"
      expect(copiedByContent.get('msg 0')?.updatedAt).toEqual(new Date(base));

      // every in-order reply chain survived the chunked insert
      for (let i = 1; i < messageCount; i += 2) {
        expect(copiedByContent.get(`msg ${i}`)?.parentId).toBe(
          copiedByContent.get(`msg ${i - 1}`)?.id,
        );
      }
      // the forward reference into a later batch was backfilled after insert
      expect(copiedByContent.get('msg 0')?.parentId).toBe(copiedByContent.get('msg 700')?.id);
      // no copied parentId points outside the copied set
      for (const message of copiedMessages) {
        if (message.parentId) expect(copiedIds.has(message.parentId)).toBe(true);
      }
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

  describe('transfer builtin backstop', () => {
    it('never rehomes a builtin agent that ended up on a roster', async () => {
      // The owned path REHOMES (userId/workspaceId), so a builtin classified
      // as owned would have someone's Inbox moved into another scope.
      const wsId = 'tb-ws';
      await serverDB.insert(workspaces).values({
        id: wsId,
        name: 'TB',
        primaryOwnerId: userId,
        slug: 'tb-ws',
      });
      await serverDB.insert(chatGroups).values({ id: 'tb-group', title: 'TB', userId });
      await serverDB.insert(agents).values({
        id: 'tb-inbox',
        slug: 'inbox',
        title: 'Inbox',
        userId,
        virtual: true,
      });
      await serverDB
        .insert(chatGroupsAgents)
        .values({ agentId: 'tb-inbox', chatGroupId: 'tb-group', userId });

      await new AgentGroupRepository(serverDB, userId).transferToWorkspace(
        'tb-group',
        wsId,
        userId,
      );

      const inbox = await serverDB.query.agents.findFirst({
        where: (a, { eq }) => eq(a.id, 'tb-inbox'),
      });
      // Stayed put: still personal scope, still the caller's.
      expect(inbox).toMatchObject({ userId, workspaceId: null });
    });
  });

  describe('removeAgentsFromGroup builtin backstop', () => {
    it('never deletes a builtin agent that ended up on a roster', async () => {
      // `addAgentsToGroup` refuses builtins at the door; this is the belt to
      // that brace, for a row that got there some other way. The blast radius
      // is somebody's Inbox.
      await serverDB.insert(chatGroups).values({ id: 'bb-group', title: 'BB', userId });
      await serverDB.insert(agents).values({
        id: 'bb-inbox',
        slug: 'inbox',
        title: 'Inbox',
        userId,
        virtual: true,
      });
      await serverDB
        .insert(chatGroupsAgents)
        .values({ agentId: 'bb-inbox', chatGroupId: 'bb-group', userId });

      await agentGroupRepo.removeAgentsFromGroup('bb-group', ['bb-inbox'], true);

      const survivors = await serverDB.query.agents.findMany({
        where: (a, { eq }) => eq(a.id, 'bb-inbox'),
      });
      expect(survivors).toHaveLength(1);
    });
  });

  describe('listReferencedMembers', () => {
    const workspaceId = 'lrm-ws';

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Referenced Member WS',
        primaryOwnerId: userId,
        slug: 'lrm-ws',
      });

      await serverDB.insert(chatGroups).values({
        id: 'lrm-group',
        title: 'Roster',
        userId,
        visibility: 'public',
        workspaceId,
      });

      await serverDB.insert(agents).values([
        // Another member's agent, still shared with the workspace.
        {
          id: 'lrm-public',
          title: 'Shared Member',
          userId: otherUserId,
          virtual: false,
          visibility: 'public',
          workspaceId,
        },
        // Same, but its owner has since taken it private again.
        {
          id: 'lrm-private',
          title: 'Secret Member',
          userId: otherUserId,
          virtual: false,
          visibility: 'private',
          workspaceId,
        },
        // Group-owned: travels with the group, so never "referenced".
        {
          id: 'lrm-owned',
          title: 'Owned Member',
          userId,
          virtual: true,
          workspaceId,
        },
      ]);

      await serverDB.insert(chatGroupsAgents).values([
        { agentId: 'lrm-public', chatGroupId: 'lrm-group', order: 0, userId, workspaceId },
        { agentId: 'lrm-private', chatGroupId: 'lrm-group', order: 1, userId, workspaceId },
        { agentId: 'lrm-owned', chatGroupId: 'lrm-group', order: 2, userId, workspaceId },
      ]);
    });

    it('reports a builtin row the transfer would clone', async () => {
      // The transfer passes `slug` and so treats a builtin on a roster as
      // referenced (cloning it); this warning must classify it the same way,
      // or it omits the exact row the move is about to act on.
      await serverDB.insert(agents).values({
        id: 'lrm-builtin',
        slug: 'inbox',
        title: 'Inbox',
        userId,
        virtual: true,
        visibility: 'public',
        workspaceId,
      });
      await serverDB.insert(chatGroupsAgents).values({
        agentId: 'lrm-builtin',
        chatGroupId: 'lrm-group',
        order: 3,
        userId,
        workspaceId,
      });

      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);
      const rows = await wsRepo.listReferencedMembers(['lrm-group']);

      expect(rows.map((row) => row.agentId)).toEqual(['lrm-public', 'lrm-builtin']);
    });

    it('omits a member the caller cannot see on the roster', async () => {
      // Seeing the GROUP is not enough. The roster itself hides a member whose
      // owner flipped it back to private, so this pre-transfer warning must not
      // become the one surface that hands out its title and avatar.
      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);

      const rows = await wsRepo.listReferencedMembers(['lrm-group']);

      expect(rows.map((row) => row.agentId)).toEqual(['lrm-public']);
    });

    it('refuses to transfer a group holding a member the caller cannot see', async () => {
      // The clone path would otherwise copy that member's title, systemRole and
      // config into a scope the caller can read — the roster hides it, and so
      // does `listReferencedMembers`, so the transfer must not be the way
      // around that.
      const wsRepo = new AgentGroupRepository(serverDB, userId, workspaceId);

      await expect(wsRepo.transferToWorkspace('lrm-group', null, userId)).rejects.toThrow(
        GROUP_HAS_INACCESSIBLE_MEMBER,
      );

      // Nothing moved.
      const group = await serverDB.query.chatGroups.findFirst({
        where: (g, { eq }) => eq(g.id, 'lrm-group'),
      });
      expect(group!.workspaceId).toBe(workspaceId);
    });

    it('returns nothing for a group the caller cannot see', async () => {
      const strangerRepo = new AgentGroupRepository(serverDB, otherUserId);

      await expect(strangerRepo.listReferencedMembers(['lrm-group'])).resolves.toEqual([]);
    });
  });
});
