import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type LobeChatDatabase } from '@/database/type';

import { SystemAgentService } from './index';

// Mock external dependencies
vi.mock('@lobechat/const', () => ({
  DEFAULT_SYSTEM_AGENT_CONFIG: {
    agentMeta: { model: 'default-model', provider: 'default-provider' },
    generationTopic: { model: 'mini-model', provider: 'mini-provider' },
    historyCompress: { model: 'default-model', provider: 'default-provider' },
    queryRewrite: { enabled: true, model: 'mini-model', provider: 'mini-provider' },
    thread: { model: 'default-model', provider: 'default-provider' },
    topic: { model: 'mini-model', provider: 'mini-provider' },
    translation: { model: 'mini-model', provider: 'mini-provider' },
  },
}));

vi.mock('@lobechat/prompts', () => ({
  chainSummaryTitle: vi.fn().mockReturnValue({
    messages: [
      { content: 'system prompt', role: 'system' },
      { content: 'user: hello\nassistant: hi there', role: 'user' },
    ],
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: vi.fn(),
  })),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

const mockDb = {} as LobeChatDatabase;
const userId = 'test-user-id';

describe('SystemAgentService', () => {
  let service: SystemAgentService;
  let mockGetUserSettings: ReturnType<typeof vi.fn>;
  let mockGenerateObject: ReturnType<typeof vi.fn>;
  let mockInitModelRuntime: ReturnType<typeof vi.fn>;
  let mockGetInfoForAIGeneration: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup UserModel mock
    mockGetUserSettings = vi.fn().mockResolvedValue(null);
    const { UserModel } = await import('@/database/models/user');
    (UserModel as any).mockImplementation(() => ({
      getUserSettings: mockGetUserSettings,
    }));

    // Setup static method mock
    mockGetInfoForAIGeneration = vi.fn().mockResolvedValue({
      responseLanguage: 'en-US',
      userName: 'Test User',
    });
    (UserModel as any).getInfoForAIGeneration = mockGetInfoForAIGeneration;

    // Setup model runtime mock
    mockGenerateObject = vi.fn().mockResolvedValue({ title: 'Generated Title' });
    mockInitModelRuntime = vi.fn().mockResolvedValue({
      generateObject: mockGenerateObject,
    });
    const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
    (initModelRuntimeFromDB as any).mockImplementation(mockInitModelRuntime);

    service = new SystemAgentService(mockDb, userId);
  });

  describe('generateTopicTitle', () => {
    const params = {
      lastAssistantContent: 'Hi there, how can I help you?',
      userPrompt: 'Hello, I need help with TypeScript.',
    };

    it('should return a generated title on success', async () => {
      const result = await service.generateTopicTitle(params);

      expect(result).toBe('Generated Title');
    });

    it('should use default topic model/provider when user has no custom config', async () => {
      mockGetUserSettings.mockResolvedValue(null);

      await service.generateTopicTitle(params);

      expect(mockInitModelRuntime).toHaveBeenCalledWith(mockDb, userId, 'mini-provider');
      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'mini-model' }),
        expect.any(Object),
      );
    });

    it('should use user custom topic model/provider when configured', async () => {
      mockGetUserSettings.mockResolvedValue({
        systemAgent: {
          topic: { model: 'custom-model', provider: 'custom-provider' },
        },
      });

      await service.generateTopicTitle(params);

      expect(mockInitModelRuntime).toHaveBeenCalledWith(mockDb, userId, 'custom-provider');
      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'custom-model' }),
        expect.any(Object),
      );
    });

    it('should use user locale in chainSummaryTitle', async () => {
      mockGetInfoForAIGeneration.mockResolvedValue({
        responseLanguage: 'zh-CN',
        userName: 'Test User',
      });
      const { chainSummaryTitle } = await import('@lobechat/prompts');

      await service.generateTopicTitle(params);

      expect(chainSummaryTitle).toHaveBeenCalledWith(
        [
          { content: params.userPrompt, role: 'user' },
          { content: params.lastAssistantContent, role: 'assistant' },
        ],
        'zh-CN',
      );
    });

    it('should return null when LLM returns empty title', async () => {
      mockGenerateObject.mockResolvedValue({ title: '' });

      const result = await service.generateTopicTitle(params);

      expect(result).toBeNull();
    });

    it('should return null when LLM returns title with only whitespace', async () => {
      mockGenerateObject.mockResolvedValue({ title: '   ' });

      const result = await service.generateTopicTitle(params);

      expect(result).toBeNull();
    });

    it('should return null when LLM returns no title field', async () => {
      mockGenerateObject.mockResolvedValue({});

      const result = await service.generateTopicTitle(params);

      expect(result).toBeNull();
    });

    it('should return null and not throw when initModelRuntimeFromDB fails', async () => {
      mockInitModelRuntime.mockRejectedValue(new Error('Model runtime error'));

      const result = await service.generateTopicTitle(params);

      expect(result).toBeNull();
    });

    it('should return null and not throw when generateObject fails', async () => {
      mockGenerateObject.mockRejectedValue(new Error('LLM API error'));

      const result = await service.generateTopicTitle(params);

      expect(result).toBeNull();
    });

    it('should return null when getUserSettings fails', async () => {
      mockGetUserSettings.mockRejectedValue(new Error('DB error'));

      const result = await service.generateTopicTitle(params);

      expect(result).toBeNull();
    });

    it('should trim whitespace from the generated title', async () => {
      mockGenerateObject.mockResolvedValue({ title: '  My Topic Title  ' });

      const result = await service.generateTopicTitle(params);

      expect(result).toBe('My Topic Title');
    });

    it('should pass RequestTrigger.Topic metadata to generateObject', async () => {
      await service.generateTopicTitle(params);

      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          metadata: expect.objectContaining({ trigger: expect.any(String) }),
        }),
      );
    });

    it('should fall back to default locale (en-US) when user has no responseLanguage', async () => {
      mockGetInfoForAIGeneration.mockResolvedValue({
        responseLanguage: undefined,
        userName: 'Test User',
      });
      const { chainSummaryTitle } = await import('@lobechat/prompts');

      await service.generateTopicTitle(params);

      // The service falls back to 'en-US' when responseLanguage is falsy
      expect(chainSummaryTitle).toHaveBeenCalledWith(expect.any(Array), 'en-US');
    });

    it('should fall back to default model/provider when systemAgent config has partial override', async () => {
      // Only agentMeta is overridden, topic should still use defaults
      mockGetUserSettings.mockResolvedValue({
        systemAgent: {
          agentMeta: { model: 'custom-meta-model', provider: 'custom-meta-provider' },
        },
      });

      await service.generateTopicTitle(params);

      // topic config not overridden, should use defaults
      expect(mockInitModelRuntime).toHaveBeenCalledWith(mockDb, userId, 'mini-provider');
      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'mini-model' }),
        expect.any(Object),
      );
    });
  });
});
