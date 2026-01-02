// @vitest-environment node
import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
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
  });
});
