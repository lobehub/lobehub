// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import * as AgentModelModule from '@/database/models/agent';
import * as ChatGroupModelModule from '@/database/models/chatGroup';
import * as UserModelModule from '@/database/models/user';
import * as AgentGroupRepoModule from '@/database/repositories/agentGroup';
import * as ChatGroupServiceModule from '@/server/services/agentGroup';

import { agentGroupRouter } from '../agentGroup';

describe('agentGroupRouter', () => {
  const userId = 'testUserId';
  let mockCtx: any;
  let agentModelMock: any;
  let chatGroupModelMock: any;
  let agentGroupRepoMock: any;
  let userModelMock: any;
  let chatGroupServiceMock: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    agentModelMock = {
      batchCreate: vi.fn(),
    };

    chatGroupModelMock = {
      addAgentsToGroup: vi.fn(),
      create: vi.fn(),
      createWithAgents: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      getGroupAgents: vi.fn(),
      queryWithMemberDetails: vi.fn(),
      removeAgentFromGroup: vi.fn(),
      update: vi.fn(),
      updateAgentInGroup: vi.fn(),
    };

    agentGroupRepoMock = {
      createGroupWithSupervisor: vi.fn(),
      findByIdWithAgents: vi.fn(),
      removeAgentsFromGroup: vi.fn(),
    };

    userModelMock = {
      getUserSettingsDefaultAgentConfig: vi.fn().mockResolvedValue({}),
    };

    chatGroupServiceMock = {
      deleteGroup: vi.fn(),
      getGroupDetail: vi.fn(),
      getGroups: vi.fn(),
      mergeAgentsDefaultConfig: vi.fn((_, agents) => agents),
      normalizeGroupConfig: vi.fn((config) =>
        config ? { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, ...config } : undefined,
      ),
    };

    // Use vi.spyOn to mock the class constructors to return our mock instances
    vi.spyOn(AgentModelModule, 'AgentModel').mockImplementation(() => agentModelMock as any);
    vi.spyOn(ChatGroupModelModule, 'ChatGroupModel').mockImplementation(
      () => chatGroupModelMock as any,
    );
    vi.spyOn(AgentGroupRepoModule, 'AgentGroupRepository').mockImplementation(
      () => agentGroupRepoMock as any,
    );
    vi.spyOn(UserModelModule, 'UserModel').mockImplementation(() => userModelMock as any);
    vi.spyOn(ChatGroupServiceModule, 'AgentGroupService').mockImplementation(
      () => chatGroupServiceMock as any,
    );

    mockCtx = {
      serverDB: {},
      userId,
    };
  });

  describe('createGroup', () => {
    it('should create a group with normalized config', async () => {
      const mockInput = {
        title: 'Test Group',
        description: 'Test Description',
        config: {
          enableSupervisor: true,
        },
      };

      const mockCreatedGroup = {
        id: 'group-1',
        title: 'Test Group',
        description: 'Test Description',
        config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, enableSupervisor: true },
      };

      agentGroupRepoMock.createGroupWithSupervisor.mockResolvedValue({
        group: mockCreatedGroup,
        supervisorAgentId: 'supervisor-1',
      });

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.createGroup(mockInput);

      expect(agentGroupRepoMock.createGroupWithSupervisor).toHaveBeenCalledWith({
        ...mockInput,
        config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, enableSupervisor: true },
      });
      expect(result).toEqual({ group: mockCreatedGroup, supervisorAgentId: 'supervisor-1' });
    });

    it('should create a group without config', async () => {
      const mockInput = {
        title: 'Test Group',
      };

      const mockCreatedGroup = {
        id: 'group-1',
        title: 'Test Group',
      };

      agentGroupRepoMock.createGroupWithSupervisor.mockResolvedValue({
        group: mockCreatedGroup,
        supervisorAgentId: 'supervisor-1',
      });

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.createGroup(mockInput);

      expect(agentGroupRepoMock.createGroupWithSupervisor).toHaveBeenCalledWith({
        ...mockInput,
        config: undefined,
      });
      expect(result).toEqual({ group: mockCreatedGroup, supervisorAgentId: 'supervisor-1' });
    });
  });

  describe('createGroupWithMembers', () => {
    it('should create a group with virtual member agents', async () => {
      const mockInput = {
        groupConfig: {
          title: 'Team Group',
          config: { enableSupervisor: true },
        },
        members: [
          { title: 'Agent 1', systemRole: 'Helper' },
          { title: 'Agent 2', systemRole: 'Assistant' },
        ],
      };

      const mockCreatedAgents = [{ id: 'agent-1' }, { id: 'agent-2' }];
      const mockCreatedGroup = { id: 'group-1', title: 'Team Group' };

      agentModelMock.batchCreate.mockResolvedValue(mockCreatedAgents);
      agentGroupRepoMock.createGroupWithSupervisor.mockResolvedValue({
        group: mockCreatedGroup,
        supervisorAgentId: 'supervisor-1',
      });

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.createGroupWithMembers(mockInput);

      expect(agentModelMock.batchCreate).toHaveBeenCalledWith([
        { title: 'Agent 1', systemRole: 'Helper', virtual: true },
        { title: 'Agent 2', systemRole: 'Assistant', virtual: true },
      ]);
      expect(agentGroupRepoMock.createGroupWithSupervisor).toHaveBeenCalledWith(
        {
          title: 'Team Group',
          config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, enableSupervisor: true },
        },
        ['agent-1', 'agent-2'],
      );
      expect(result).toEqual({
        agentIds: ['agent-1', 'agent-2'],
        groupId: 'group-1',
        supervisorAgentId: 'supervisor-1',
      });
    });
  });

  describe('deleteGroup', () => {
    it('should delete a group by id', async () => {
      chatGroupServiceMock.deleteGroup.mockResolvedValue({
        deletedVirtualAgentIds: [],
        group: { id: 'group-1' },
      });

      const caller = agentGroupRouter.createCaller(mockCtx);
      await caller.deleteGroup({ id: 'group-1' });

      expect(chatGroupServiceMock.deleteGroup).toHaveBeenCalledWith('group-1');
    });
  });

  describe('getGroup', () => {
    it('should get a group by id', async () => {
      const mockGroup = {
        id: 'group-1',
        title: 'Test Group',
        config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
      };

      chatGroupModelMock.findById.mockResolvedValue(mockGroup);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroup({ id: 'group-1' });

      expect(chatGroupModelMock.findById).toHaveBeenCalledWith('group-1');
      expect(result).toEqual(mockGroup);
    });

    it('should return undefined if group not found', async () => {
      chatGroupModelMock.findById.mockResolvedValue(undefined);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroup({ id: 'non-existent' });

      expect(result).toBeUndefined();
    });
  });

  describe('getGroupDetail', () => {
    it('should get group detail with agents', async () => {
      const mockGroupDetail = {
        id: 'group-1',
        title: 'Test Group',
        config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
        agents: [
          { id: 'agent-1', title: 'Agent 1' },
          { id: 'agent-2', title: 'Agent 2' },
        ],
      };

      chatGroupServiceMock.getGroupDetail.mockResolvedValue(mockGroupDetail);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroupDetail({ id: 'group-1' });

      expect(chatGroupServiceMock.getGroupDetail).toHaveBeenCalledWith('group-1');
      expect(result).toEqual(mockGroupDetail);
    });

    it('should return null if group not found', async () => {
      chatGroupServiceMock.getGroupDetail.mockResolvedValue(null);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroupDetail({ id: 'non-existent' });

      expect(result).toBeNull();
    });
  });

  describe('getGroupAgents', () => {
    it('should get agents of a group', async () => {
      const mockAgents = [
        { agentId: 'agent-1', chatGroupId: 'group-1', order: 0 },
        { agentId: 'agent-2', chatGroupId: 'group-1', order: 1 },
      ];

      chatGroupModelMock.getGroupAgents.mockResolvedValue(mockAgents);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroupAgents({ groupId: 'group-1' });

      expect(chatGroupModelMock.getGroupAgents).toHaveBeenCalledWith('group-1');
      expect(result).toEqual(mockAgents);
    });
  });

  describe('getGroups', () => {
    it('should get all groups with member details', async () => {
      const mockGroups = [
        { id: 'group-1', title: 'Group 1', agents: [] },
        { id: 'group-2', title: 'Group 2', agents: [] },
      ];

      chatGroupServiceMock.getGroups.mockResolvedValue(mockGroups);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.getGroups();

      expect(chatGroupServiceMock.getGroups).toHaveBeenCalled();
      expect(result).toEqual(mockGroups);
    });
  });

  describe('addAgentsToGroup', () => {
    it('should add agents to a group', async () => {
      const mockInput = {
        groupId: 'group-1',
        agentIds: ['agent-1', 'agent-2'],
      };

      const mockResult = [
        { agentId: 'agent-1', chatGroupId: 'group-1' },
        { agentId: 'agent-2', chatGroupId: 'group-1' },
      ];

      chatGroupModelMock.addAgentsToGroup.mockResolvedValue(mockResult);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.addAgentsToGroup(mockInput);

      expect(chatGroupModelMock.addAgentsToGroup).toHaveBeenCalledWith('group-1', [
        'agent-1',
        'agent-2',
      ]);
      expect(result).toEqual(mockResult);
    });
  });

  describe('removeAgentsFromGroup', () => {
    it('should remove agents from a group', async () => {
      const mockInput = {
        groupId: 'group-1',
        agentIds: ['agent-1', 'agent-2'],
      };

      const mockResult = {
        deletedVirtualAgentIds: [],
        removedFromGroup: 2,
      };

      agentGroupRepoMock.removeAgentsFromGroup.mockResolvedValue(mockResult);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.removeAgentsFromGroup(mockInput);

      expect(agentGroupRepoMock.removeAgentsFromGroup).toHaveBeenCalledWith(
        'group-1',
        ['agent-1', 'agent-2'],
        undefined,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('updateAgentInGroup', () => {
    it('should update agent in a group', async () => {
      const mockInput = {
        groupId: 'group-1',
        agentId: 'agent-1',
        updates: { order: 2, role: 'leader' },
      };

      const mockResult = {
        agentId: 'agent-1',
        chatGroupId: 'group-1',
        order: 2,
        role: 'leader',
      };

      chatGroupModelMock.updateAgentInGroup.mockResolvedValue(mockResult);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.updateAgentInGroup(mockInput);

      expect(chatGroupModelMock.updateAgentInGroup).toHaveBeenCalledWith('group-1', 'agent-1', {
        order: 2,
        role: 'leader',
      });
      expect(result).toEqual(mockResult);
    });

    it('should update agent with enabled flag', async () => {
      const mockInput = {
        groupId: 'group-1',
        agentId: 'agent-1',
        updates: { enabled: false },
      };

      chatGroupModelMock.updateAgentInGroup.mockResolvedValue({});

      const caller = agentGroupRouter.createCaller(mockCtx);
      await caller.updateAgentInGroup(mockInput);

      expect(chatGroupModelMock.updateAgentInGroup).toHaveBeenCalledWith('group-1', 'agent-1', {
        enabled: false,
      });
    });
  });

  describe('updateGroup', () => {
    it('should update a group with normalized config', async () => {
      const mockInput = {
        id: 'group-1',
        value: {
          title: 'Updated Title',
          config: { enableSupervisor: false },
        },
      };

      const mockUpdatedGroup = {
        id: 'group-1',
        title: 'Updated Title',
        config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, enableSupervisor: false },
      };

      chatGroupModelMock.update.mockResolvedValue(mockUpdatedGroup);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.updateGroup(mockInput);

      expect(chatGroupModelMock.update).toHaveBeenCalledWith('group-1', {
        title: 'Updated Title',
        config: { ...DEFAULT_CHAT_GROUP_CHAT_CONFIG, enableSupervisor: false },
      });
      expect(result).toEqual(mockUpdatedGroup);
    });

    it('should update a group without config changes', async () => {
      const mockInput = {
        id: 'group-1',
        value: {
          title: 'New Title',
          description: 'New Description',
        },
      };

      const mockUpdatedGroup = {
        id: 'group-1',
        title: 'New Title',
        description: 'New Description',
      };

      chatGroupModelMock.update.mockResolvedValue(mockUpdatedGroup);

      const caller = agentGroupRouter.createCaller(mockCtx);
      const result = await caller.updateGroup(mockInput);

      expect(chatGroupModelMock.update).toHaveBeenCalledWith('group-1', {
        title: 'New Title',
        description: 'New Description',
        config: undefined,
      });
      expect(result).toEqual(mockUpdatedGroup);
    });
  });
});
