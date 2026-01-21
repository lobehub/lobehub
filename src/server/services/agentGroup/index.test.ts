// @vitest-environment node
import { DEFAULT_AGENT_CONFIG, DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { AgentGroupRepository } from '@/database/repositories/agentGroup';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';

import { AgentGroupService } from './index';

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn(),
}));

vi.mock('@/database/repositories/agentGroup', () => ({
  AgentGroupRepository: vi.fn(),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultAgentConfig: vi.fn(),
}));

describe('AgentGroupService', () => {
  let service: AgentGroupService;
  const mockDb = {} as any;
  const mockUserId = 'test-user-id';

  let mockAgentModel: any;
  let mockChatGroupModel: any;
  let mockAgentGroupRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAgentModel = {
      batchDelete: vi.fn(),
    };

    mockChatGroupModel = {
      queryWithMemberDetails: vi.fn(),
      getGroupAgents: vi.fn(),
      delete: vi.fn(),
    };

    mockAgentGroupRepo = {
      findByIdWithAgents: vi.fn(),
      checkAgentsBeforeRemoval: vi.fn(),
    };

    (AgentModel as any).mockImplementation(() => mockAgentModel);
    (ChatGroupModel as any).mockImplementation(() => mockChatGroupModel);
    (AgentGroupRepository as any).mockImplementation(() => mockAgentGroupRepo);
    (getServerDefaultAgentConfig as any).mockReturnValue({});

    service = new AgentGroupService(mockDb, mockUserId);
  });

  describe('getGroupDetail', () => {
    it('should return group details by ID', async () => {
      const mockGroupId = 'group-1';
      const mockGroupDetail = {
        id: 'group-1',
        name: 'Test Group',
        agents: [
          { id: 'agent-1', name: 'Agent 1' },
          { id: 'agent-2', name: 'Agent 2' },
        ],
      };

      mockAgentGroupRepo.findByIdWithAgents.mockResolvedValue(mockGroupDetail);

      const result = await service.getGroupDetail(mockGroupId);

      expect(mockAgentGroupRepo.findByIdWithAgents).toHaveBeenCalledWith(mockGroupId);
      expect(result).toEqual(mockGroupDetail);
    });

    it('should handle null when group does not exist', async () => {
      mockAgentGroupRepo.findByIdWithAgents.mockResolvedValue(null);

      const result = await service.getGroupDetail('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getGroups', () => {
    it('should return all groups with member details', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          name: 'Group 1',
          members: [{ id: 'agent-1' }],
        },
        {
          id: 'group-2',
          name: 'Group 2',
          members: [{ id: 'agent-2' }],
        },
      ];

      mockChatGroupModel.queryWithMemberDetails.mockResolvedValue(mockGroups);

      const result = await service.getGroups();

      expect(mockChatGroupModel.queryWithMemberDetails).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockGroups);
    });

    it('should return empty array when no groups exist', async () => {
      mockChatGroupModel.queryWithMemberDetails.mockResolvedValue([]);

      const result = await service.getGroups();

      expect(result).toEqual([]);
    });
  });

  describe('deleteGroup', () => {
    it('should delete group and its virtual agents', async () => {
      const groupId = 'group-1';
      const mockGroupAgents = [
        { agentId: 'agent-1' },
        { agentId: 'agent-2' },
        { agentId: 'agent-3' },
      ];
      const mockVirtualAgents = [{ id: 'agent-1' }, { id: 'agent-3' }];
      const mockDeletedGroup = { id: groupId, name: 'Deleted Group' };

      mockChatGroupModel.getGroupAgents.mockResolvedValue(mockGroupAgents);
      mockAgentGroupRepo.checkAgentsBeforeRemoval.mockResolvedValue({
        virtualAgents: mockVirtualAgents,
        sharedAgents: [],
      });
      mockChatGroupModel.delete.mockResolvedValue(mockDeletedGroup);
      mockAgentModel.batchDelete.mockResolvedValue(undefined);

      const result = await service.deleteGroup(groupId);

      expect(mockChatGroupModel.getGroupAgents).toHaveBeenCalledWith(groupId);
      expect(mockAgentGroupRepo.checkAgentsBeforeRemoval).toHaveBeenCalledWith(groupId, [
        'agent-1',
        'agent-2',
        'agent-3',
      ]);
      expect(mockChatGroupModel.delete).toHaveBeenCalledWith(groupId);
      expect(mockAgentModel.batchDelete).toHaveBeenCalledWith(['agent-1', 'agent-3']);
      expect(result).toEqual({
        deletedVirtualAgentIds: ['agent-1', 'agent-3'],
        group: mockDeletedGroup,
      });
    });

    it('should delete group without deleting agents when no virtual agents exist', async () => {
      const groupId = 'group-2';
      const mockGroupAgents = [{ agentId: 'agent-4' }, { agentId: 'agent-5' }];
      const mockDeletedGroup = { id: groupId, name: 'Group without virtual agents' };

      mockChatGroupModel.getGroupAgents.mockResolvedValue(mockGroupAgents);
      mockAgentGroupRepo.checkAgentsBeforeRemoval.mockResolvedValue({
        virtualAgents: [],
        sharedAgents: [],
      });
      mockChatGroupModel.delete.mockResolvedValue(mockDeletedGroup);

      const result = await service.deleteGroup(groupId);

      expect(mockChatGroupModel.delete).toHaveBeenCalledWith(groupId);
      expect(mockAgentModel.batchDelete).not.toHaveBeenCalled();
      expect(result).toEqual({
        deletedVirtualAgentIds: [],
        group: mockDeletedGroup,
      });
    });

    it('should handle deletion of empty group', async () => {
      const groupId = 'empty-group';
      const mockDeletedGroup = { id: groupId, name: 'Empty Group' };

      mockChatGroupModel.getGroupAgents.mockResolvedValue([]);
      mockAgentGroupRepo.checkAgentsBeforeRemoval.mockResolvedValue({
        virtualAgents: [],
        sharedAgents: [],
      });
      mockChatGroupModel.delete.mockResolvedValue(mockDeletedGroup);

      const result = await service.deleteGroup(groupId);

      expect(mockChatGroupModel.getGroupAgents).toHaveBeenCalledWith(groupId);
      expect(mockAgentGroupRepo.checkAgentsBeforeRemoval).toHaveBeenCalledWith(groupId, []);
      expect(mockAgentModel.batchDelete).not.toHaveBeenCalled();
      expect(result).toEqual({
        deletedVirtualAgentIds: [],
        group: mockDeletedGroup,
      });
    });

    it('should preserve non-virtual agents when deleting group', async () => {
      const groupId = 'mixed-group';
      const mockGroupAgents = [
        { agentId: 'virtual-agent-1' },
        { agentId: 'regular-agent-1' },
        { agentId: 'virtual-agent-2' },
      ];
      const mockVirtualAgents = [{ id: 'virtual-agent-1' }, { id: 'virtual-agent-2' }];
      const mockDeletedGroup = { id: groupId, name: 'Mixed Group' };

      mockChatGroupModel.getGroupAgents.mockResolvedValue(mockGroupAgents);
      mockAgentGroupRepo.checkAgentsBeforeRemoval.mockResolvedValue({
        virtualAgents: mockVirtualAgents,
        sharedAgents: [{ id: 'regular-agent-1' }],
      });
      mockChatGroupModel.delete.mockResolvedValue(mockDeletedGroup);

      const result = await service.deleteGroup(groupId);

      // Should only delete virtual agents
      expect(mockAgentModel.batchDelete).toHaveBeenCalledWith([
        'virtual-agent-1',
        'virtual-agent-2',
      ]);
      expect(result.deletedVirtualAgentIds).toEqual(['virtual-agent-1', 'virtual-agent-2']);
    });
  });

  describe('normalizeGroupConfig', () => {
    it('should merge config with DEFAULT_CHAT_GROUP_CHAT_CONFIG', () => {
      const customConfig = {
        scene: 'casual' as const,
        enableHistoryCount: false,
        historyCount: 10,
      };

      const result = service.normalizeGroupConfig(customConfig);

      expect(result).toEqual({
        ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
        ...customConfig,
      });
    });

    it('should return undefined when config is null', () => {
      const result = service.normalizeGroupConfig(null);

      expect(result).toBeUndefined();
    });

    it('should return undefined when config is undefined', () => {
      const result = service.normalizeGroupConfig(undefined);

      expect(result).toBeUndefined();
    });

    it('should preserve custom properties in config', () => {
      const customConfig = {
        scene: 'productive' as const,
        enableHistoryCount: true,
        historyCount: 20,
        customField: 'custom-value',
      };

      const result = service.normalizeGroupConfig(customConfig as any);

      expect(result).toMatchObject(customConfig);
    });

    it('should use defaults when config is empty object with scene', () => {
      const result = service.normalizeGroupConfig({ scene: 'productive' });

      expect(result).toEqual({
        ...DEFAULT_CHAT_GROUP_CHAT_CONFIG,
        scene: 'productive',
      });
    });
  });

  describe('mergeAgentsDefaultConfig', () => {
    it('should merge 4-layer config correctly (DEFAULT → server → user → agent)', () => {
      const serverDefaultConfig = {
        model: 'gpt-4',
        params: { temperature: 0.7 },
      };
      const userDefaultConfig = {
        config: {
          params: { temperature: 0.5 },
          systemRole: 'User default system role',
        },
      };
      const agents = [
        {
          id: 'agent-1',
          systemRole: 'Agent specific role',
          model: 'claude-3',
        },
      ];

      (getServerDefaultAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const result = service.mergeAgentsDefaultConfig(userDefaultConfig, agents);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        // From DEFAULT_AGENT_CONFIG
        chatConfig: DEFAULT_AGENT_CONFIG.chatConfig,
        plugins: DEFAULT_AGENT_CONFIG.plugins,
        tts: DEFAULT_AGENT_CONFIG.tts,
        // From serverDefaultConfig (overrides DEFAULT)
        model: 'claude-3', // Agent config overrides server
        params: { temperature: 0.5 }, // User config overrides server
        // From agent (overrides all)
        id: 'agent-1',
        systemRole: 'Agent specific role', // Agent overrides user default
      });
    });

    it('should handle empty user default config', () => {
      const serverDefaultConfig = { model: 'gpt-4' };
      const agents = [
        {
          id: 'agent-1',
          systemRole: 'Custom role',
        },
      ];

      (getServerDefaultAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const result = service.mergeAgentsDefaultConfig({}, agents);

      expect(result[0]).toMatchObject({
        model: 'gpt-4', // From server default
        systemRole: 'Custom role', // From agent
      });
    });

    it('should handle multiple agents', () => {
      const agents = [
        { id: 'agent-1', model: 'gpt-4' },
        { id: 'agent-2', model: 'claude-3' },
        { id: 'agent-3', systemRole: 'Agent 3 role' },
      ];

      (getServerDefaultAgentConfig as any).mockReturnValue({});

      const result = service.mergeAgentsDefaultConfig({}, agents);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('agent-1');
      expect(result[0].model).toBe('gpt-4');
      expect(result[1].id).toBe('agent-2');
      expect(result[1].model).toBe('claude-3');
      expect(result[2].id).toBe('agent-3');
      expect(result[2].systemRole).toBe('Agent 3 role');
    });

    it('should prioritize agent config over all defaults', () => {
      const serverDefaultConfig = {
        model: 'gpt-3.5',
        provider: 'openai',
      };
      const userDefaultConfig = {
        config: {
          model: 'gpt-4',
          provider: 'openai',
        },
      };
      const agents = [
        {
          id: 'agent-1',
          model: 'claude-3',
          provider: 'anthropic',
        },
      ];

      (getServerDefaultAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const result = service.mergeAgentsDefaultConfig(userDefaultConfig, agents);

      // Agent config should override everything
      expect(result[0].model).toBe('claude-3');
      expect(result[0].provider).toBe('anthropic');
    });

    it('should clean empty values from agent config', () => {
      const agents = [
        {
          id: 'agent-1',
          model: 'gpt-4',
          emptyField: null,
          undefinedField: undefined,
          systemRole: '',
        },
      ];

      (getServerDefaultAgentConfig as any).mockReturnValue({});

      const result = service.mergeAgentsDefaultConfig({}, agents);

      // cleanObject should remove null/undefined/empty values
      expect(result[0].id).toBe('agent-1');
      expect(result[0].model).toBe('gpt-4');
      // Empty values should be cleaned by cleanObject before merging
    });

    it('should handle empty agents array', () => {
      const result = service.mergeAgentsDefaultConfig({}, []);

      expect(result).toEqual([]);
    });

    it('should preserve all DEFAULT_AGENT_CONFIG properties', () => {
      const agents = [{ id: 'agent-1' }];

      (getServerDefaultAgentConfig as any).mockReturnValue({});

      const result = service.mergeAgentsDefaultConfig({}, agents);

      expect(result[0]).toMatchObject({
        chatConfig: DEFAULT_AGENT_CONFIG.chatConfig,
        plugins: DEFAULT_AGENT_CONFIG.plugins,
        tts: DEFAULT_AGENT_CONFIG.tts,
      });
    });

    it('should handle userDefaultConfig without config property', () => {
      const userDefaultConfig = { someOtherProperty: 'value' };
      const agents = [{ id: 'agent-1', model: 'gpt-4' }];

      (getServerDefaultAgentConfig as any).mockReturnValue({});

      const result = service.mergeAgentsDefaultConfig(userDefaultConfig as any, agents);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('agent-1');
      expect(result[0].model).toBe('gpt-4');
    });

    it('should handle complex nested config merge', () => {
      const serverDefaultConfig = {
        params: {
          temperature: 0.7,
          max_tokens: 1000,
        },
        plugins: ['plugin-1'],
      };
      const userDefaultConfig = {
        config: {
          params: {
            temperature: 0.5,
            top_p: 0.9,
          },
          plugins: ['plugin-2'],
        },
      };
      const agents = [
        {
          id: 'agent-1',
          params: {
            max_tokens: 2000,
          },
        },
      ];

      (getServerDefaultAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const result = service.mergeAgentsDefaultConfig(userDefaultConfig, agents);

      // Should have merged nested params correctly
      expect(result[0].params).toMatchObject({
        temperature: 0.5, // From user default
        max_tokens: 2000, // From agent (overrides server and user)
        top_p: 0.9, // From user default
      });
    });
  });
});
