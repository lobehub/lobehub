// @vitest-environment node
import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { initializeRedisWithPrefix, isRedisEnabled,RedisKeys } from '@/libs/redis';
import { parseAgentConfig } from '@/server/globalConfig/parseDefaultAgent';

import { AgentService } from './index';

vi.mock('@/envs/app', () => ({
  appEnv: {
    DEFAULT_AGENT_CONFIG: 'model=gpt-4;temperature=0.7',
  },
  getAppConfig: () => ({
    DEFAULT_AGENT_CONFIG: 'model=gpt-4;temperature=0.7',
  }),
}));

vi.mock('@/server/globalConfig/parseDefaultAgent', () => ({
  parseAgentConfig: vi.fn(),
}));

vi.mock('@/database/models/session', () => ({
  SessionModel: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(),
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: vi.fn().mockReturnValue({ enabled: true }),
}));

vi.mock('@/libs/redis', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/libs/redis')>();
  return {
    ...original,
    initializeRedisWithPrefix: vi.fn(),
    isRedisEnabled: vi.fn(),
  };
});

describe('AgentService', () => {
  let service: AgentService;
  const mockDb = {} as any;
  const mockUserId = 'test-user-id';

  // Default mock for UserModel that returns empty settings
  const mockUserModel = {
    getUserSettings: vi.fn().mockResolvedValue({}),
    getUserSettingsDefaultAgentConfig: vi.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default UserModel mock
    (UserModel as any).mockImplementation(() => mockUserModel);
    service = new AgentService(mockDb, mockUserId);
  });

  describe('createInbox', () => {
    it('should create inbox with default agent config', async () => {
      const mockConfig = { model: 'gpt-4', temperature: 0.7 };
      const mockSessionModel = {
        createInbox: vi.fn(),
      };

      (SessionModel as any).mockImplementation(() => mockSessionModel);
      (parseAgentConfig as any).mockReturnValue(mockConfig);

      await service.createInbox();

      expect(SessionModel).toHaveBeenCalledWith(mockDb, mockUserId);
      expect(parseAgentConfig).toHaveBeenCalledWith('model=gpt-4;temperature=0.7');
      expect(mockSessionModel.createInbox).toHaveBeenCalledWith(mockConfig);
    });

    it('should create inbox with empty config if parseAgentConfig returns undefined', async () => {
      const mockSessionModel = {
        createInbox: vi.fn(),
      };

      (SessionModel as any).mockImplementation(() => mockSessionModel);
      (parseAgentConfig as any).mockReturnValue(undefined);

      await service.createInbox();

      expect(SessionModel).toHaveBeenCalledWith(mockDb, mockUserId);
      expect(parseAgentConfig).toHaveBeenCalledWith('model=gpt-4;temperature=0.7');
      expect(mockSessionModel.createInbox).toHaveBeenCalledWith({});
    });
  });

  describe('getBuiltinAgent', () => {
    it('should return null if agent does not exist', async () => {
      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(null),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});

      // Need to recreate service to use the new mock
      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('non-existent');

      expect(result).toBeNull();
    });

    it('should merge DEFAULT_AGENT_CONFIG and serverDefaultAgentConfig with agent config', async () => {
      const mockAgent = {
        id: 'agent-1',
        slug: 'inbox',
        systemRole: 'Custom system role',
      };
      const serverDefaultConfig = { model: 'gpt-4', params: { temperature: 0.7 } };

      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('inbox');

      // Should have DEFAULT_AGENT_CONFIG as base
      expect(result).toMatchObject({
        // From DEFAULT_AGENT_CONFIG
        chatConfig: DEFAULT_AGENT_CONFIG.chatConfig,
        plugins: DEFAULT_AGENT_CONFIG.plugins,
        tts: DEFAULT_AGENT_CONFIG.tts,
        // From serverDefaultConfig (overrides DEFAULT_AGENT_CONFIG)
        model: 'gpt-4',
        params: { temperature: 0.7 },
        // From mockAgent (overrides all)
        id: 'agent-1',
        slug: 'inbox',
        systemRole: 'Custom system role',
      });
    });

    it('should prioritize agent config over server default config', async () => {
      const mockAgent = {
        id: 'agent-1',
        slug: 'inbox',
        model: 'claude-3',
        provider: 'anthropic',
      };
      const serverDefaultConfig = { model: 'gpt-4', provider: 'openai' };

      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('inbox');

      // Agent config should override server default
      expect(result?.model).toBe('claude-3');
      expect(result?.provider).toBe('anthropic');
    });

    it('should merge avatar from builtin-agents package definition', async () => {
      const mockAgent = {
        id: 'agent-1',
        slug: 'inbox',
        model: 'gpt-4',
      };

      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('inbox');

      // Avatar should be merged from BUILTIN_AGENTS definition
      expect((result as any)?.avatar).toBe('/avatars/lobe-ai.png');
    });

    it('should not include avatar for non-builtin agents', async () => {
      const mockAgent = {
        id: 'agent-1',
        slug: 'custom-agent',
        model: 'gpt-4',
      };

      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('custom-agent');

      // Avatar should not be present for non-builtin agents
      expect((result as any)?.avatar).toBeUndefined();
    });
  });

  describe('getAgentConfig', () => {
    it('should return null if agent does not exist', async () => {
      const mockAgentModel = {
        getAgentConfig: vi.fn().mockResolvedValue(null),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfig('non-existent');

      expect(result).toBeNull();
    });

    it('should support lookup by agent id', async () => {
      const mockAgent = {
        id: 'agent-123',
        model: 'gpt-4',
        systemRole: 'Test role',
      };

      const mockAgentModel = {
        getAgentConfig: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfig('agent-123');

      expect(mockAgentModel.getAgentConfig).toHaveBeenCalledWith('agent-123');
      expect(result?.id).toBe('agent-123');
      expect(result?.model).toBe('gpt-4');
    });

    it('should support lookup by slug', async () => {
      const mockAgent = {
        id: 'agent-123',
        model: 'claude-3',
        slug: 'my-agent',
      };

      const mockAgentModel = {
        getAgentConfig: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfig('my-agent');

      expect(mockAgentModel.getAgentConfig).toHaveBeenCalledWith('my-agent');
      expect(result?.id).toBe('agent-123');
    });

    it('should merge DEFAULT_AGENT_CONFIG and serverDefaultAgentConfig with agent config', async () => {
      const mockAgent = {
        id: 'agent-1',
        systemRole: 'Custom system role',
      };
      const serverDefaultConfig = { model: 'gpt-4', params: { temperature: 0.7 } };

      const mockAgentModel = {
        getAgentConfig: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfig('agent-1');

      expect(result).toMatchObject({
        chatConfig: DEFAULT_AGENT_CONFIG.chatConfig,
        plugins: DEFAULT_AGENT_CONFIG.plugins,
        tts: DEFAULT_AGENT_CONFIG.tts,
        model: 'gpt-4',
        params: { temperature: 0.7 },
        id: 'agent-1',
        systemRole: 'Custom system role',
      });
    });

    it('should use default model/provider when agent has none', async () => {
      const mockAgent = {
        id: 'agent-1',
        systemRole: 'Test',
        // No model or provider set
      };

      const mockAgentModel = {
        getAgentConfig: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfig('agent-1');

      // Should have default model/provider from DEFAULT_AGENT_CONFIG
      expect(result?.model).toBe(DEFAULT_AGENT_CONFIG.model);
      expect(result?.provider).toBe(DEFAULT_AGENT_CONFIG.provider);
    });

    it('should prioritize agent model/provider over defaults', async () => {
      const mockAgent = {
        id: 'agent-1',
        model: 'claude-3-opus',
        provider: 'anthropic',
      };
      const serverDefaultConfig = { model: 'gpt-4', provider: 'openai' };

      const mockAgentModel = {
        getAgentConfig: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfig('agent-1');

      // Agent config should override server default
      expect(result?.model).toBe('claude-3-opus');
      expect(result?.provider).toBe('anthropic');
    });

    it('should merge user default agent config', async () => {
      const mockAgent = {
        id: 'agent-1',
      };
      const userDefaultConfig = { model: 'user-preferred-model', provider: 'user-provider' };

      const mockAgentModel = {
        getAgentConfig: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});
      // Use mockResolvedValueOnce to avoid affecting subsequent tests
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValueOnce({ config: userDefaultConfig });

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfig('agent-1');

      // User default config should be applied
      expect(result?.model).toBe('user-preferred-model');
      expect(result?.provider).toBe('user-provider');
    });
  });

  describe('getAgentConfigById', () => {
    it('should return null if agent does not exist', async () => {
      const mockAgentModel = {
        getAgentConfigById: vi.fn().mockResolvedValue(null),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfigById('non-existent');

      expect(result).toBeNull();
    });

    it('should merge DEFAULT_AGENT_CONFIG and serverDefaultAgentConfig with agent config', async () => {
      const mockAgent = {
        id: 'agent-1',
        systemRole: 'Custom system role',
      };
      const serverDefaultConfig = { model: 'gpt-4', params: { temperature: 0.7 } };

      const mockAgentModel = {
        getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfigById('agent-1');

      // Should have DEFAULT_AGENT_CONFIG as base
      expect(result).toMatchObject({
        // From DEFAULT_AGENT_CONFIG
        chatConfig: DEFAULT_AGENT_CONFIG.chatConfig,
        plugins: DEFAULT_AGENT_CONFIG.plugins,
        tts: DEFAULT_AGENT_CONFIG.tts,
        // From serverDefaultConfig (overrides DEFAULT_AGENT_CONFIG)
        model: 'gpt-4',
        params: { temperature: 0.7 },
        // From mockAgent (overrides all)
        id: 'agent-1',
        systemRole: 'Custom system role',
      });
    });

    it('should prioritize agent config over server default config', async () => {
      const mockAgent = {
        id: 'agent-1',
        model: 'claude-3',
        provider: 'anthropic',
      };
      const serverDefaultConfig = { model: 'gpt-4', provider: 'openai' };

      const mockAgentModel = {
        getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(() => mockAgentModel);
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfigById('agent-1');

      // Agent config should override server default
      expect(result?.model).toBe('claude-3');
      expect(result?.provider).toBe('anthropic');
    });

    describe('Redis welcome data integration', () => {
      const mockRedisGet = vi.fn();
      const mockRedisClient = { get: mockRedisGet };

      beforeEach(() => {
        vi.mocked(initializeRedisWithPrefix).mockReset();
        vi.mocked(isRedisEnabled).mockReset();
        mockRedisGet.mockReset();
      });

      it('should merge Redis welcome data when available', async () => {
        const mockAgent = {
          id: 'agent-1',
          model: 'gpt-4',
        };
        const welcomeData = {
          openQuestions: ['Question 1?', 'Question 2?'],
          welcomeMessage: 'Hello from Redis!',
        };

        const mockAgentModel = {
          getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
        };

        (AgentModel as any).mockImplementation(() => mockAgentModel);
        (parseAgentConfig as any).mockReturnValue({});
        vi.mocked(isRedisEnabled).mockReturnValue(true);
        vi.mocked(initializeRedisWithPrefix).mockResolvedValue(mockRedisClient as any);
        mockRedisGet.mockResolvedValue(JSON.stringify(welcomeData));

        const newService = new AgentService(mockDb, mockUserId);
        const result = await newService.getAgentConfigById('agent-1');

        expect(result?.openingMessage).toBe('Hello from Redis!');
        expect(result?.openingQuestions).toEqual(['Question 1?', 'Question 2?']);
        expect(mockRedisGet).toHaveBeenCalledWith(RedisKeys.aiGeneration.agentWelcome('agent-1'));
      });

      it('should return normal config when Redis is disabled', async () => {
        const mockAgent = {
          id: 'agent-1',
          model: 'gpt-4',
          openingMessage: 'Default message',
        };

        const mockAgentModel = {
          getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
        };

        (AgentModel as any).mockImplementation(() => mockAgentModel);
        (parseAgentConfig as any).mockReturnValue({});
        vi.mocked(isRedisEnabled).mockReturnValue(false);

        const newService = new AgentService(mockDb, mockUserId);
        const result = await newService.getAgentConfigById('agent-1');

        // Should keep original config, not override with Redis data
        expect(result?.openingMessage).toBe('Default message');
        // openingQuestions comes from DEFAULT_AGENT_CONFIG (empty array)
        expect(result?.openingQuestions).toEqual([]);
        expect(initializeRedisWithPrefix).not.toHaveBeenCalled();
      });

      it('should return normal config when Redis key does not exist', async () => {
        const mockAgent = {
          id: 'agent-1',
          model: 'gpt-4',
        };

        const mockAgentModel = {
          getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
        };

        (AgentModel as any).mockImplementation(() => mockAgentModel);
        (parseAgentConfig as any).mockReturnValue({});
        vi.mocked(isRedisEnabled).mockReturnValue(true);
        vi.mocked(initializeRedisWithPrefix).mockResolvedValue(mockRedisClient as any);
        mockRedisGet.mockResolvedValue(null);

        const newService = new AgentService(mockDb, mockUserId);
        const result = await newService.getAgentConfigById('agent-1');

        // No Redis welcome data, so openingMessage remains from DEFAULT_AGENT_CONFIG
        expect(result?.openingMessage).toBeUndefined();
        // openingQuestions comes from DEFAULT_AGENT_CONFIG (empty array)
        expect(result?.openingQuestions).toEqual([]);
      });

      it('should gracefully fallback when Redis throws error', async () => {
        const mockAgent = {
          id: 'agent-1',
          model: 'gpt-4',
        };

        const mockAgentModel = {
          getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
        };

        (AgentModel as any).mockImplementation(() => mockAgentModel);
        (parseAgentConfig as any).mockReturnValue({});
        vi.mocked(isRedisEnabled).mockReturnValue(true);
        vi.mocked(initializeRedisWithPrefix).mockRejectedValue(new Error('Redis connection failed'));

        const newService = new AgentService(mockDb, mockUserId);
        const result = await newService.getAgentConfigById('agent-1');

        // Should return normal config without error
        expect(result?.id).toBe('agent-1');
        expect(result?.model).toBe('gpt-4');
      });

      it('should gracefully handle invalid JSON in Redis', async () => {
        const mockAgent = {
          id: 'agent-1',
          model: 'gpt-4',
        };

        const mockAgentModel = {
          getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
        };

        (AgentModel as any).mockImplementation(() => mockAgentModel);
        (parseAgentConfig as any).mockReturnValue({});
        vi.mocked(isRedisEnabled).mockReturnValue(true);
        vi.mocked(initializeRedisWithPrefix).mockResolvedValue(mockRedisClient as any);
        mockRedisGet.mockResolvedValue('invalid json {');

        const newService = new AgentService(mockDb, mockUserId);
        const result = await newService.getAgentConfigById('agent-1');

        // Should return normal config without error
        expect(result?.id).toBe('agent-1');
        expect(result?.openingMessage).toBeUndefined();
      });
    });
  });
});
