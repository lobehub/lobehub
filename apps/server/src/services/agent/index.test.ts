// @vitest-environment node
import { BUILTIN_AGENTS } from '@lobechat/builtin-agents';
import { DEFAULT_AGENT_CONFIG, DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { AgentShareModel } from '@/database/models/agentShare';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import type * as RedisModule from '@/libs/redis';
import { initializeRedisWithPrefix, isRedisEnabled, RedisKeys } from '@/libs/redis';
import { parseAgentConfig } from '@/server/globalConfig/parseDefaultAgent';

import { AgentService } from './index';

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AGENT_SHARE_ALLOWED_PROVIDERS: ['lobehub'],
}));

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

vi.mock('@/database/models/agentShare', () => ({ AgentShareModel: vi.fn() }));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(),
}));

vi.mock('@/envs/redis', () => ({
  getRedisConfig: vi.fn().mockReturnValue({ enabled: true }),
}));

vi.mock('@/libs/redis', async (importOriginal) => {
  const original = await importOriginal<typeof RedisModule>();
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
  const mockWorkspaceId = 'workspace-1';

  // Default mock for UserModel that returns empty settings
  const mockUserModel = {
    getUserSettings: vi.fn().mockResolvedValue({}),
    getUserSettingsDefaultAgentConfig: vi.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default UserModel mock
    (UserModel as any).mockImplementation(function () {
      return mockUserModel;
    });
    service = new AgentService(mockDb, mockUserId);
  });

  describe('createInbox', () => {
    it('should create inbox with default agent config', async () => {
      const mockConfig = { model: 'gpt-4', temperature: 0.7 };
      const mockSessionModel = {
        createInbox: vi.fn(),
      };

      (SessionModel as any).mockImplementation(function () {
        return mockSessionModel;
      });
      (parseAgentConfig as any).mockReturnValue(mockConfig);

      await service.createInbox();

      expect(SessionModel).toHaveBeenCalledWith(mockDb, mockUserId, undefined);
      expect(parseAgentConfig).toHaveBeenCalledWith('model=gpt-4;temperature=0.7');
      expect(mockSessionModel.createInbox).toHaveBeenCalledWith(mockConfig);
    });

    it('should create inbox with empty config if parseAgentConfig returns undefined', async () => {
      const mockSessionModel = {
        createInbox: vi.fn(),
      };

      (SessionModel as any).mockImplementation(function () {
        return mockSessionModel;
      });
      (parseAgentConfig as any).mockReturnValue(undefined);

      await service.createInbox();

      expect(SessionModel).toHaveBeenCalledWith(mockDb, mockUserId, undefined);
      expect(parseAgentConfig).toHaveBeenCalledWith('model=gpt-4;temperature=0.7');
      expect(mockSessionModel.createInbox).toHaveBeenCalledWith({});
    });

    it('should create workspace inbox in the active workspace scope', async () => {
      const mockSessionModel = {
        createInbox: vi.fn(),
      };

      (SessionModel as any).mockImplementation(function () {
        return mockSessionModel;
      });
      (parseAgentConfig as any).mockReturnValue({});

      const workspaceService = new AgentService(mockDb, mockUserId, mockWorkspaceId);
      await workspaceService.createInbox();

      expect(SessionModel).toHaveBeenCalledWith(mockDb, mockUserId, mockWorkspaceId);
      expect(mockSessionModel.createInbox).toHaveBeenCalledWith({});
    });
  });

  describe('getBuiltinAgent', () => {
    it('should return null if agent does not exist', async () => {
      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(null),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('inbox');

      // Agent config should override server default
      expect(result?.model).toBe('claude-3');
      expect(result?.provider).toBe('anthropic');
    });

    it('should fallback inbox title and avatar', async () => {
      const mockAgent = {
        avatar: null,
        id: 'agent-1',
        slug: 'inbox',
        title: null,
        model: 'gpt-4',
      };

      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('inbox');

      expect((result as any)?.avatar).toBe(DEFAULT_INBOX_AVATAR);
      expect((result as any)?.title).toBe(DEFAULT_INBOX_TITLE);
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('custom-agent');

      // Avatar should not be present for non-builtin agents
      expect((result as any)?.avatar).toBeUndefined();
    });

    it('should NOT inherit the member personal default model for a workspace inbox', async () => {
      // Workspace inbox is persisted with an empty model/provider.
      const mockAgent = {
        id: 'agent-1',
        slug: 'inbox',
      };
      const serverDefaultConfig = { model: 'system-default-model', provider: 'system-provider' };

      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);
      // The member opening the workspace inbox has a personal default model.
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValueOnce({
        config: { model: 'opus-4.6', provider: 'anthropic' },
      });

      const workspaceService = new AgentService(mockDb, mockUserId, mockWorkspaceId);
      const result = await workspaceService.getBuiltinAgent('inbox');

      // Should fall back to the system default, NOT the member's personal model.
      expect(result?.model).toBe('system-default-model');
      expect(result?.provider).toBe('system-provider');
    });

    it('should still apply the personal default model for a personal inbox', async () => {
      const mockAgent = {
        id: 'agent-1',
        slug: 'inbox',
      };

      const mockAgentModel = {
        getBuiltinAgent: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue({});
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValueOnce({
        config: { model: 'user-preferred-model', provider: 'user-provider' },
      });

      // No workspaceId → personal scope keeps the personal default behavior.
      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getBuiltinAgent('inbox');

      expect(result?.model).toBe('user-preferred-model');
      expect(result?.provider).toBe('user-provider');
    });
  });

  describe('getAgentConfig', () => {
    it('should return null if agent does not exist', async () => {
      const mockAgentModel = {
        getAgentConfig: vi.fn().mockResolvedValue(null),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue({});
      // Use mockResolvedValueOnce to avoid affecting subsequent tests
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValueOnce({
        config: userDefaultConfig,
      });

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfig('agent-1');

      // User default config should be applied
      expect(result?.model).toBe('user-preferred-model');
      expect(result?.provider).toBe('user-provider');
    });
  });

  describe('resolveModelSelection', () => {
    it("layers the user's default over the server default for an agent without a model", async () => {
      (parseAgentConfig as any).mockReturnValue({ model: 'server-model', provider: 'server' });
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValueOnce({
        config: { model: 'user-preferred-model', provider: 'user-provider' },
      });

      await expect(service.resolveModelSelection({ model: null, provider: null })).resolves.toEqual(
        { model: 'user-preferred-model', provider: 'user-provider' },
      );
    });

    it('falls back to the server default, then the hardcoded default, without a user default', async () => {
      (parseAgentConfig as any).mockReturnValue({ model: 'server-model' });
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValueOnce(undefined);

      await expect(service.resolveModelSelection({})).resolves.toEqual({
        model: 'server-model',
        provider: DEFAULT_AGENT_CONFIG.provider,
      });
    });

    it("keeps the agent's own model over every default", async () => {
      (parseAgentConfig as any).mockReturnValue({ model: 'server-model', provider: 'server' });
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValueOnce({
        config: { model: 'user-preferred-model', provider: 'user-provider' },
      });

      await expect(
        service.resolveModelSelection({ model: 'claude-3-opus', provider: 'anthropic' }),
      ).resolves.toEqual({ model: 'claude-3-opus', provider: 'anthropic' });
    });

    it('does not let a workspace agent inherit a personal default model', async () => {
      (parseAgentConfig as any).mockReturnValue({});
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValueOnce({
        config: { model: 'user-preferred-model', provider: 'user-provider' },
      });
      const workspaceService = new AgentService(mockDb, mockUserId, mockWorkspaceId);

      await expect(workspaceService.resolveModelSelection({})).resolves.toEqual({
        model: DEFAULT_AGENT_CONFIG.model,
        provider: DEFAULT_AGENT_CONFIG.provider,
      });
    });
  });

  describe('getAgentConfigById', () => {
    it('should return null if agent does not exist', async () => {
      const mockAgentModel = {
        getAgentConfigById: vi.fn().mockResolvedValue(null),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
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

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue(serverDefaultConfig);

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfigById('agent-1');

      // Agent config should override server default
      expect(result?.model).toBe('claude-3');
      expect(result?.provider).toBe('anthropic');
    });

    // Builtin agent rows are provisioned without avatar; the client replaces its
    // cached entry with this snapshot, so the snapshot must carry the builtin
    // avatar or the UI degrades to the default robot avatar
    it('should fall back to the builtin avatar when a builtin agent row has none', async () => {
      const mockAgent = {
        avatar: null,
        id: 'agent-task',
        slug: 'task-agent',
        title: '任务助手',
      };

      const mockAgentModel = {
        getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfigById('agent-task');

      expect(result?.avatar).toBe(BUILTIN_AGENTS['task-agent']?.avatar);
      expect(result?.title).toBe('任务助手');
    });

    it('should fall back inbox avatar and title when the inbox row has none', async () => {
      const mockAgent = {
        avatar: null,
        id: 'agent-inbox',
        slug: 'inbox',
        title: null,
      };

      const mockAgentModel = {
        getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfigById('agent-inbox');

      expect(result?.avatar).toBe(DEFAULT_INBOX_AVATAR);
      expect(result?.title).toBe(DEFAULT_INBOX_TITLE);
    });

    it('should keep a custom avatar over the builtin fallback', async () => {
      const mockAgent = {
        avatar: 'https://example.com/custom.png',
        id: 'agent-task',
        slug: 'task-agent',
      };

      const mockAgentModel = {
        getAgentConfigById: vi.fn().mockResolvedValue(mockAgent),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);
      const result = await newService.getAgentConfigById('agent-task');

      expect(result?.avatar).toBe('https://example.com/custom.png');
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

        (AgentModel as any).mockImplementation(function () {
          return mockAgentModel;
        });
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

        (AgentModel as any).mockImplementation(function () {
          return mockAgentModel;
        });
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

        (AgentModel as any).mockImplementation(function () {
          return mockAgentModel;
        });
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

        (AgentModel as any).mockImplementation(function () {
          return mockAgentModel;
        });
        (parseAgentConfig as any).mockReturnValue({});
        vi.mocked(isRedisEnabled).mockReturnValue(true);
        vi.mocked(initializeRedisWithPrefix).mockRejectedValue(
          new Error('Redis connection failed'),
        );

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

        (AgentModel as any).mockImplementation(function () {
          return mockAgentModel;
        });
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

  describe('share provider restrictions', () => {
    const storedAgent = { id: 'agent-1', model: 'gpt-4', provider: 'lobehub' };
    let agent: Omit<typeof storedAgent, 'provider'> & { provider: string | null };
    let visibility: string;

    beforeEach(() => {
      agent = { ...storedAgent };
      visibility = 'link';
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValue({});
      vi.mocked(parseAgentConfig).mockReturnValue({ provider: 'lobehub' });
      vi.mocked(AgentModel).mockImplementation(function () {
        return {
          getAgentConfigById: vi.fn(async () => agent),
          updateConfig: vi.fn(async (_id, patch) => {
            agent = { ...agent, ...patch };
          }),
        } as unknown as AgentModel;
      });
      vi.mocked(AgentShareModel).mockImplementation(function () {
        return { getByAgentId: vi.fn(async () => ({ visibility })) } as unknown as AgentShareModel;
      });
      vi.mocked(isRedisEnabled).mockReturnValue(false);
      service = new AgentService(mockDb, mockUserId);
    });

    it('rejects changing a shared agent to a third-party provider without saving it', async () => {
      await expect(
        service.updateAgentConfig('agent-1', { provider: 'supergrok' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(agent.provider).toBe('lobehub');
    });

    it('allows changing the model within the supported provider', async () => {
      await expect(service.updateAgentConfig('agent-1', { model: 'gpt-5' })).resolves.toMatchObject(
        { success: true },
      );
      expect(agent.model).toBe('gpt-5');
    });

    it('allows third-party providers when there is no share', async () => {
      vi.mocked(AgentShareModel).mockImplementation(function () {
        return { getByAgentId: vi.fn(async () => null) } as unknown as AgentShareModel;
      });
      await expect(
        service.updateAgentConfig('agent-1', { provider: 'openai' }),
      ).resolves.toMatchObject({ success: true });
      expect(agent.provider).toBe('openai');
    });

    it('allows third-party providers after sharing is disabled', async () => {
      visibility = 'private';
      await expect(
        service.updateAgentConfig('agent-1', { provider: 'supergrok' }),
      ).resolves.toMatchObject({ success: true });
      expect(agent.provider).toBe('supergrok');
    });

    it('does not block unrelated edits to legacy shared agents', async () => {
      agent.provider = 'supergrok';
      await expect(
        service.updateAgentConfig('agent-1', { title: 'Updated title' }),
      ).resolves.toMatchObject({ success: true });
    });

    it('rejects publishing a third-party model', async () => {
      agent.provider = 'supergrok';
      await expect(service.assertShareModelAllowed('agent-1')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('resolves inherited providers before publishing', async () => {
      agent.provider = null;
      await expect(service.assertShareModelAllowed('agent-1')).resolves.toBeUndefined();
      mockUserModel.getUserSettingsDefaultAgentConfig.mockResolvedValue({
        config: { provider: 'openai' },
      });
      await expect(service.assertShareModelAllowed('agent-1')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('updateAgentConfig', () => {
    it('should throw when the updated agent cannot be read back', async () => {
      const mockAgentModel = {
        getAgentConfigById: vi.fn().mockResolvedValue(null),
        updateConfig: vi.fn().mockResolvedValue(undefined),
      };

      (AgentModel as any).mockImplementation(function () {
        return mockAgentModel;
      });
      (parseAgentConfig as any).mockReturnValue({});

      const newService = new AgentService(mockDb, mockUserId);

      await expect(
        newService.updateAgentConfig('missing-agent', { systemRole: 'new prompt' }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Agent not found',
      });
    });
  });
});
