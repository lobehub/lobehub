import type {
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeConfig,
  AiProviderRuntimeState,
  EnabledProvider,
} from '@lobechat/types';
import type { AiProviderModelListItem, EnabledAiModel, ExtendParamsType } from 'model-bank';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { AiInfraRepos } from './index';

const userId = 'test-user-id';
const mockProviderConfigs = {
  openai: { enabled: true },
  anthropic: { enabled: false },
};

let serverDB: LobeChatDatabase;
let repo: AiInfraRepos;

beforeAll(async () => {
  serverDB = await getTestDB();
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs);
});

describe('AiInfraRepos', () => {
  describe('getAiProviderList', () => {
    it('should merge builtin and user providers correctly', async () => {
      const mockUserProviders = [
        { id: 'openai', enabled: true, name: 'Custom OpenAI' },
        { id: 'custom', enabled: true, name: 'Custom Provider' },
      ] as AiProviderListItem[];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValueOnce(mockUserProviders);

      const result = await repo.getAiProviderList();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      // Verify the merge logic
      const openaiProvider = result.find((p) => p.id === 'openai');
      expect(openaiProvider).toMatchObject({ enabled: true, name: 'Custom OpenAI' });
    });

    it('should sort providers according to DEFAULT_MODEL_PROVIDER_LIST order', async () => {
      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValue([]);

      const result = await repo.getAiProviderList();

      expect(result).toEqual(
        expect.arrayContaining(
          DEFAULT_MODEL_PROVIDER_LIST.map((item) =>
            expect.objectContaining({
              id: item.id,
              source: 'builtin',
            }),
          ),
        ),
      );
    });
  });

  describe('getUserEnabledProviderList', () => {
    it('should return only enabled providers', async () => {
      const mockProviders = [
        { id: 'openai', enabled: true, name: 'OpenAI', sort: 1 },
        { id: 'anthropic', enabled: false, name: 'Anthropic', sort: 2 },
      ] as AiProviderListItem[];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);

      const result = await repo.getUserEnabledProviderList();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'openai',
        name: 'OpenAI',
      });
    });

    it('should return only enabled provider', async () => {
      const mockProviders = [
        {
          enabled: true,
          id: 'openai',
          logo: 'logo1',
          name: 'OpenAI',
          sort: 1,
          source: 'builtin' as const,
        },
        {
          enabled: false,
          id: 'anthropic',
          logo: 'logo2',
          name: 'Anthropic',
          sort: 2,
          source: 'builtin' as const,
        },
      ];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValue(mockProviders);

      const result = await repo.getUserEnabledProviderList();

      expect(result).toEqual([
        {
          id: 'openai',
          logo: 'logo1',
          name: 'OpenAI',
          source: 'builtin',
        },
      ]);
    });
  });

  describe('getEnabledModels', () => {
    it('should merge and filter enabled models', async () => {
      const mockProviders = [{ id: 'openai', enabled: true }] as AiProviderListItem[];
      const mockAllModels = [
        { id: 'gpt-4', providerId: 'openai', enabled: true },
      ] as EnabledAiModel[];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(mockAllModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        { id: 'gpt-4', enabled: true, type: 'chat' },
      ]);

      const result = await repo.getEnabledModels();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toMatchObject({
        id: 'gpt-4',
        providerId: 'openai',
      });
    });

    it('should merge builtin and user models correctly', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', sort: 1, source: 'builtin' as const },
      ];

      const mockAllModels = [
        {
          abilities: { vision: true },
          displayName: 'Custom GPT-4',
          enabled: true,
          id: 'gpt-4',
          providerId: 'openai',
          sort: 1,
          type: 'chat' as const,
          contextWindowTokens: 10,
        },
      ];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(mockAllModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          abilities: {},
          displayName: 'GPT-4',
          enabled: true,
          id: 'gpt-4',
          type: 'chat' as const,
        },
      ]);

      const result = await repo.getEnabledModels();

      expect(result).toContainEqual(
        expect.objectContaining({
          abilities: { vision: true },
          displayName: 'Custom GPT-4',
          enabled: true,
          contextWindowTokens: 10,
          id: 'gpt-4',
          providerId: 'openai',
          sort: 1,
          type: 'chat',
        }),
      );
    });

    it('should handle case when user model not found', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', sort: 1, source: 'builtin' as const },
      ];

      const mockAllModels: any[] = [];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(mockAllModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          abilities: { reasoning: true },
          displayName: 'GPT-4',
          enabled: true,
          id: 'gpt-4',
          type: 'chat' as const,
        },
      ]);

      const result = await repo.getEnabledModels();

      expect(result[0]).toEqual(
        expect.objectContaining({
          abilities: { reasoning: true },
          enabled: true,
          id: 'gpt-4',
          providerId: 'openai',
        }),
      );
    });

    it('should include settings property from builtin model', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' },
      ] as AiProviderListItem[];
      const mockAllModels: EnabledAiModel[] = [];
      const mockSettings = { searchImpl: 'tool' as const };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(mockAllModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          enabled: true,
          id: 'gpt-4',
          settings: mockSettings,
          type: 'chat',
        },
      ]);

      const result = await repo.getEnabledModels();

      expect(result[0]).toMatchObject({
        id: 'gpt-4',
        settings: mockSettings,
      });
    });

    it('should return all models including disabled ones when filterEnabled is false', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' },
        { enabled: false, id: 'anthropic', name: 'Anthropic', source: 'builtin' },
      ] as AiProviderListItem[];

      const mockAllModels = [
        {
          abilities: {},
          enabled: false,
          id: 'claude-3',
          providerId: 'anthropic',
          type: 'chat' as const,
        },
      ] as EnabledAiModel[];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(mockAllModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          enabled: true,
          id: 'gpt-4',
          type: 'chat' as const,
        },
        {
          enabled: false,
          id: 'claude-3',
          type: 'chat' as const,
        },
      ]);

      const result = await repo.getEnabledModels(false);

      // Should include both enabled and disabled models
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'gpt-4',
            enabled: true,
            providerId: 'openai',
          }),
          expect.objectContaining({
            id: 'claude-3',
            enabled: false,
            providerId: 'anthropic',
          }),
        ]),
      );
      // Verify we have at least the expected models (may have more from builtin models)
      expect(result.length).toBeGreaterThanOrEqual(2);

      // Verify disabled models are included
      const disabledModels = result.filter((model) => !model.enabled);
      expect(disabledModels.length).toBeGreaterThan(0);
    });

    it('should allow search=true and add searchImpl=params when user enables it without providing settings (builtin has no search and no settings)', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ] as AiProviderListItem[];

      // User explicitly enables search but provides no settings field
      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { search: true },
        // no settings on user model
      };

      // Builtin does NOT have search capability and thus no settings
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          id: 'gpt-4',
          enabled: true,
          type: 'chat' as const,
          abilities: { search: false },
          // no settings since builtin search is false
        },
      ]);

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find(
        (m) => m.id === 'gpt-4' && m.providerId === 'openai' && m.type === 'chat',
      );
      expect(merged).toBeDefined();
      expect(merged?.abilities).toMatchObject({ search: true });
      // settings should remain undefined because builtin had none and user never has settings
      expect(merged?.settings).toEqual({ searchImpl: 'params' });
    });

    it('should remove builtin rearch settings and disable search when user turns search off', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ] as AiProviderListItem[];

      // User explicitly disables search and provides no settings field
      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { search: false },
        // no settings on user model
      };

      const builtinSettings = { searchImpl: 'tool' as const };

      // Builtin has search capability and corresponding settings
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          id: 'gpt-4',
          enabled: true,
          type: 'chat' as const,
          abilities: { search: true },
          settings: builtinSettings,
        },
      ]);

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find(
        (m) => m.id === 'gpt-4' && m.providerId === 'openai' && m.type === 'chat',
      );
      expect(merged).toBeDefined();
      // User's choice takes precedence
      expect(merged?.abilities).toMatchObject({ search: false });
      // Builtin settings are preserved on the merged model
      expect(merged?.settings).toBeUndefined();
    });

    it('should set search=true and settings=params for custom provider when user enables search and builtin has no search/settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'custom', name: 'Custom Provider', source: 'custom' as const },
      ] as AiProviderListItem[];

      // Builtin (preset) has the model but without search and without settings
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          id: 'my-model',
          enabled: true,
          type: 'chat' as const,
          abilities: { search: false },
          // no settings
        } as any,
      ]);

      // User explicitly enables search; user models do not carry settings
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([
        {
          id: 'my-model',
          providerId: 'custom',
          enabled: true,
          type: 'chat',
          abilities: { search: true },
        } as EnabledAiModel,
      ]);

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'my-model' && m.providerId === 'custom');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toMatchObject({ search: true });
      // For custom provider, when user enables search with no builtin settings, default to 'params'
      expect(merged?.settings).toEqual({ searchImpl: 'params' });
    });

    // 测试场景：用户模型 abilitie 为空（Empty），而基础模型有搜索能力和设置
    it('should retain builtin abilities and settings when user model has no abilities (empty) and builtin has settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: {}, // Empty object, no search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: { search: false }, // 使用 builtin abilities
        settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 使用 builtin abilities
      expect(merged?.abilities?.search).toEqual(false);
      // 删去 builtin settings
      expect(merged?.settings).toBeUndefined();
    });

    it('should retain builtin abilities and settings when user model has no abilities (empty) and builtin has settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: {}, // Empty object, no search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: { search: true }, // 使用 builtin abilities
        settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 使用 builtin abilities
      expect(merged?.abilities?.search).toEqual(true);
      // 保留 builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'google' });
    });

    // 测试场景：用户模型未启用搜索（abilities.search 为 undefined），而基础模型有搜索能力和设置
    it('should retain builtin settings when user model has no abilities.search (undefined) and builtin has settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { vision: true }, // 启用 vision 能力, no search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: { search: false }, // builtin abilities 不生效
        settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // abilities.search 仍 undefined（兼容老版本）
      expect(merged?.abilities?.search).toBeUndefined();
      // 保留 builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'google' });
    });

    it('should retain builtin settings when user model has no abilities.search (undefined) and builtin has settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { vision: true }, // 启用 vision 能力, no search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: { search: true }, // builtin abilities 不生效
        settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // abilities.search 仍 undefined（兼容老版本）
      expect(merged?.abilities?.search).toBeUndefined();
      // 保留 builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'google' });
    });

    // 测试场景：用户模型未启用搜索（abilities.search 为 undefined），而基础模型也无搜索能力和设置
    it('should retain no settings when user model has no abilities.search (undefined) and builtin has no settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: {}, // 无 search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: {},
        // builtin 无 settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities?.search).toBeUndefined();
      // 无 settings
      expect(merged?.settings).toBeUndefined();
    });

    // 测试：用户模型有 abilities.search: true
    it('should inject defaults when user has search: true, no existing settings (builtin none)', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { search: true }, // 用户启用 search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: {},
        // 无 settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: true });
      // 注入 defaults (openai: params)
      expect(merged?.settings).toEqual({ searchImpl: 'params' });
    });

    it('should retain existing settings when user has search: true and builtin has settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { search: true },
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        settings: { searchImpl: 'tool' }, // builtin 有 settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: true });
      // 使用 builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'tool' });
    });

    // 测试：用户模型有 abilities.search: false
    it('should remove settings when user has search: false and builtin has settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { search: false }, // 用户禁用 search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        settings: { searchImpl: 'tool', extendParams: [] }, // builtin 有 settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: false });
      // 移除 search 相关，保留其他
      expect(merged?.settings).toEqual({ extendParams: [] });
    });

    it('should keep no settings when user has search: false and no existing settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { search: false },
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        // 无 settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: false });
      // 无 settings
      expect(merged?.settings).toBeUndefined();
    });

    it('should prefer user settings over builtin settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: {},
        settings: { searchImpl: 'params', searchProvider: 'user-provider' },
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        settings: { searchImpl: 'tool', searchProvider: 'builtin-provider' },
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 应该使用用户的 settings，不是内置的
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'user-provider' });
    });

    it('should use builtin settings when user has no settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { vision: true },
        // 用户未设置 settings
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        settings: { searchImpl: 'tool', searchProvider: 'google' },
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 应该使用内置的 settings
      expect(merged?.settings).toEqual({ searchImpl: 'tool', searchProvider: 'google' });
    });

    it('should merge builtin settings with user-provided extend params', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        abilities: {},
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        settings: { extendParams: ['reasoningEffort'] as ExtendParamsType[] },
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        settings: {
          extendParams: ['thinking'] as ExtendParamsType[],
          searchImpl: 'params',
          searchProvider: 'builtin-provider',
        },
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.settings).toEqual({
        extendParams: ['reasoningEffort'],
        searchImpl: 'params',
        searchProvider: 'builtin-provider',
      });
    });

    it('should have no settings when both user and builtin have no settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { vision: true },
        // 用户未设置 settings
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        // 内置也无 settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 无 settings
      expect(merged?.settings).toBeUndefined();
    });
  });

  describe('getAiProviderModelList', () => {
    it('should merge builtin and user models', async () => {
      const providerId = 'openai';
      const mockUserModels = [
        { id: 'custom-gpt4', enabled: true, type: 'chat' },
      ] as AiProviderModelListItem[];
      const mockBuiltinModels = [{ id: 'gpt-4', enabled: true }];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(mockUserModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(mockBuiltinModels);

      const result = await repo.getAiProviderModelList(providerId);

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'custom-gpt4' }),
          expect.objectContaining({ id: 'gpt-4' }),
        ]),
      );
    });

    it('should merge default and custom models', async () => {
      const mockCustomModels = [
        {
          displayName: 'Custom GPT-4',
          enabled: false,
          id: 'gpt-4',
          type: 'chat' as const,
        },
      ];

      const mockDefaultModels = [
        {
          displayName: 'GPT-4',
          enabled: true,
          id: 'gpt-4',
          type: 'chat' as const,
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(mockCustomModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(mockDefaultModels);

      const result = await repo.getAiProviderModelList('openai');

      expect(result).toContainEqual(
        expect.objectContaining({
          displayName: 'Custom GPT-4',
          enabled: false,
          id: 'gpt-4',
        }),
      );
    });

    it('should use builtin models', async () => {
      const providerId = 'ai21';

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue([]);

      const result = await repo.getAiProviderModelList(providerId);

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'jamba-mini' }),
          expect.objectContaining({ id: 'jamba-large' }),
        ]),
      );
    });

    it('should return empty if not exist provider', async () => {
      const providerId = 'abc';

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue([]);

      const result = await repo.getAiProviderModelList(providerId);

      expect(result).toHaveLength(0);
    });

    it('should support offset/limit pagination', async () => {
      const providerId = 'openai';
      const userModels = Array.from({ length: 5 }).map((_, i) => ({
        enabled: i % 2 === 0,
        id: `u-${i + 1}`,
        type: 'chat',
      })) as AiProviderModelListItem[];

      const builtinModels = Array.from({ length: 5 }).map((_, i) => ({
        enabled: true,
        id: `b-${i + 1}`,
        type: 'chat',
      })) as AiProviderModelListItem[];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const all = await repo.getAiProviderModelList(providerId);
      const result = await repo.getAiProviderModelList(providerId, { limit: 3, offset: 2 });

      expect(result.map((i) => i.id)).toEqual(all.slice(2, 5).map((i) => i.id));
    });

    it('should support enabled filter with pagination', async () => {
      const providerId = 'openai';

      const userModels = [
        { enabled: false, id: 'u-1', type: 'chat' },
        { enabled: true, id: 'u-2', type: 'chat' },
        { enabled: false, id: 'u-3', type: 'chat' },
      ] as AiProviderModelListItem[];

      const builtinModels = [
        { enabled: false, id: 'b-1', type: 'chat' },
        { enabled: true, id: 'b-2', type: 'chat' },
      ] as AiProviderModelListItem[];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId, {
        enabled: false,
        limit: 10,
        offset: 0,
      });

      expect(result.map((i) => i.id)).toEqual(['u-1', 'u-3', 'b-1']);
    });

    // New tests for getAiProviderModelList per the corrected behavior
    it('should allow search=true and add searchImpl=params when user enables it without providing settings (builtin has no search and no settings)', async () => {
      const providerId = 'openai';

      // User explicitly enables search in custom model, but provides no settings
      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: true },
          // user never has settings
        } as any,
      ];

      // Builtin has no search and no settings
      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: false },
          // no settings
        } as any,
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged!.abilities).toMatchObject({ search: true });
      // when user enables search with no settings, default searchImpl should be 'params'
      expect(merged!.settings).toEqual({ searchImpl: 'params' });
    });

    it('should remove builtin search settings and disable search when user turns search off', async () => {
      const providerId = 'openai';

      // User explicitly disables search in custom model, and provides no settings
      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: false },
          // user never has settings
        } as any,
      ];

      // Builtin has search with settings
      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: true },
          settings: { searchImpl: 'tool' },
        } as any,
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // User's choice takes precedence
      expect(merged!.abilities).toMatchObject({ search: false });
      // Builtin search settings should be removed since user turned search off
      expect(merged!.settings).toBeUndefined();
    });

    it('should set search=true and settings=params for custom provider when user enables search and builtin has no search/settings', async () => {
      const providerId = 'custom';

      // User list: model with search enabled, but no settings
      const userModels: AiProviderModelListItem[] = [
        {
          id: 'my-model',
          type: 'chat',
          enabled: true,
          abilities: { search: true },
          // user never has settings
        } as any,
      ];

      // Default list: same model without search and without settings
      const defaultModels: AiProviderModelListItem[] = [
        {
          id: 'my-model',
          type: 'chat',
          enabled: true,
          abilities: { search: false },
          // no settings
        } as any,
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(defaultModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'my-model') as any;
      expect(merged).toBeDefined();
      expect(merged.abilities).toMatchObject({ search: true });
      // For custom provider, when user enables search with no builtin settings, default to 'params'
      expect(merged.settings).toEqual({ searchImpl: 'params' });
    });

    // 测试场景：用户模型 abilitie 为空（Empty），而基础模型有搜索能力和设置
    it('should retain builtin abilities and settings when user model has no abilities (empty) and builtin has settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: {}, // Empty object, no search
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: false }, // 使用 builtin abilities
          settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 使用 builtin abilities
      expect(merged?.abilities?.search).toEqual(false);
      // 保留 builtin settings
      expect(merged?.settings).toBeUndefined();
    });

    it('should retain builtin abilities and settings when user model has no abilities (empty) and builtin has settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: {}, // Empty object, no search
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: true }, // 使用 builtin abilities
          settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 使用 builtin abilities
      expect(merged?.abilities?.search).toEqual(true);
      // 保留 builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'google' });
    });

    // 测试场景：用户模型未启用搜索（abilities.search 为 undefined），而基础模型有搜索能力和设置
    it('should retain builtin settings when user model has no abilities (empty) and builtin has settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { vision: true }, // 启用 vision 能力, no search
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: false }, // builtin abilities 会被 merge
          settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // abilities.search 会被 merge 为 false，此处和 getEnabledAiModel 不同
      expect(merged?.abilities?.search).toEqual(false);
      // 删去 builtin settings
      expect(merged?.settings).toBeUndefined();
    });

    it('should retain builtin settings when user model has no abilities (empty) and builtin has settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { vision: true }, // 启用 vision 能力, no search
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: true }, // builtin abilities 会被 merge
          settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // abilities.search 会被 merge 为 true，此处和 getEnabledAiModel 不同
      expect(merged?.abilities?.search).toEqual(true);
      // 保留 builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'google' });
    });

    // 测试：用户模型无 abilities.search（undefined），保留 builtin settings（mergeArrayById 优先用户，但用户无则 builtin）
    it('should retain builtin settings when user model has no abilities.search (undefined) and builtin has settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: {}, // 无 search
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: {},
          settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin 有
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities?.search).toBeUndefined();
      // 保留 builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'google' });
    });

    it('should retain no settings when user model has no abilities.search (undefined) and builtin has no settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: {}, // 无 search
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          // 无 settings
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities?.search).toBeUndefined();
      // 无 settings
      expect(merged?.settings).toBeUndefined();
    });

    // 测试：用户模型有 abilities.search: true
    it('should inject defaults when user has search: true, no existing settings (builtin none)', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: true }, // 用户启用
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          // 无 settings
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: true });
      // 注入 defaults
      expect(merged?.settings).toEqual({ searchImpl: 'params' });
    });

    it('should retain existing settings when user has search: true and builtin has settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: true },
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          settings: { searchImpl: 'tool' },
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: true });
      // 使用 builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'tool' });
    });

    // 测试：用户模型有 abilities.search: false
    it('should remove settings when user has search: false and builtin has settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: false }, // 用户禁用
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          settings: { searchImpl: 'tool', extendParams: [] },
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: false });
      // 移除 search 相关，保留其他
      expect(merged?.settings).toEqual({ extendParams: [] });
    });

    it('should keep no settings when user has search: false and no existing settings', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { search: false },
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          // 无 settings
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: false });
      // 无 settings
      expect(merged?.settings).toBeUndefined();
    });

    it('should prefer user settings over builtin settings in getAiProviderModelList', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: {},
          settings: { searchImpl: 'params', searchProvider: 'user-provider' },
        } as any,
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          settings: { searchImpl: 'tool', searchProvider: 'builtin-provider' },
        } as any,
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 应该使用用户的 settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'user-provider' });
    });

    it('should use builtin settings when user has no settings in getAiProviderModelList', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { vision: true },
          // 用户未设置 settings
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          settings: { searchImpl: 'tool', searchProvider: 'google' },
        } as any,
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 应该使用内置的 settings
      expect(merged?.settings).toEqual({ searchImpl: 'tool', searchProvider: 'google' });
    });

    it('should have no settings when both user and builtin have no settings in getAiProviderModelList', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          abilities: { vision: true },
          // 用户未设置 settings
        },
      ];

      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'gpt-4',
          type: 'chat',
          enabled: true,
          // 内置也无 settings
        },
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // 无 settings
      expect(merged?.settings).toBeUndefined();
    });
  });

  describe('getAiProviderRuntimeState', () => {
    it('should return complete runtime state', async () => {
      const mockRuntimeConfig = {
        openai: { apiKey: 'test-key' },
      } as unknown as Record<string, AiProviderRuntimeConfig>;
      const mockEnabledProviders = [{ id: 'openai', name: 'OpenAI' }] as EnabledProvider[];
      const mockEnabledModels = [
        { id: 'gpt-4', providerId: 'openai', enabled: true },
      ] as EnabledAiModel[];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue(
        mockRuntimeConfig,
      );
      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue(mockEnabledProviders);
      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue(mockEnabledModels);

      const result = await repo.getAiProviderRuntimeState();

      expect(result).toMatchObject({
        enabledAiProviders: mockEnabledProviders,
        enabledAiModels: mockEnabledModels,
        runtimeConfig: expect.any(Object),
      });
    });

    it('should return provider runtime state', async () => {
      const mockRuntimeConfig = {
        openai: {
          apiKey: 'test-key',
        },
      } as unknown as Record<string, AiProviderRuntimeConfig>;

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue(
        mockRuntimeConfig,
      );

      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue([
        { id: 'openai', logo: 'logo1', name: 'OpenAI', source: 'builtin' },
      ]);

      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue([
        {
          abilities: {},
          enabled: true,
          id: 'gpt-4',
          providerId: 'openai',
          type: 'chat',
        },
      ]);

      const result = await repo.getAiProviderRuntimeState();

      expect(result).toEqual({
        enabledAiModels: [
          expect.objectContaining({
            enabled: true,
            id: 'gpt-4',
            providerId: 'openai',
          }),
        ],
        enabledAiProviders: [{ id: 'openai', logo: 'logo1', name: 'OpenAI', source: 'builtin' }],
        enabledChatAiProviders: [
          { id: 'openai', logo: 'logo1', name: 'OpenAI', source: 'builtin' },
        ],
        enabledImageAiProviders: [],
        runtimeConfig: {
          openai: {
            apiKey: 'test-key',
            enabled: true,
          },
        },
      });
    });

    it('should return provider runtime state with enabledImageAiProviders', async () => {
      const mockRuntimeConfig = {
        fal: {
          apiKey: 'test-fal-key',
        },
        openai: {
          apiKey: 'test-openai-key',
        },
      } as unknown as Record<string, AiProviderRuntimeConfig>;

      vi.spyOn(repo.aiProviderModel, 'getAiProviderRuntimeConfig').mockResolvedValue(
        mockRuntimeConfig,
      );

      // Mock providers including fal for image generation
      vi.spyOn(repo, 'getUserEnabledProviderList').mockResolvedValue([
        { id: 'openai', logo: 'openai-logo', name: 'OpenAI', source: 'builtin' },
        { id: 'fal', logo: 'fal-logo', name: 'Fal', source: 'builtin' },
      ]);

      // Mock models including image models from fal
      vi.spyOn(repo, 'getEnabledModels').mockResolvedValue([
        {
          abilities: {},
          enabled: true,
          id: 'gpt-4',
          providerId: 'openai',
          type: 'chat',
        },
        {
          abilities: {},
          enabled: true,
          id: 'flux/schnell',
          providerId: 'fal',
          type: 'image',
        },
        {
          abilities: {},
          enabled: true,
          id: 'flux-kontext/dev',
          providerId: 'fal',
          type: 'image',
        },
      ]);

      const result = await repo.getAiProviderRuntimeState();

      expect(result).toEqual({
        enabledAiModels: [
          expect.objectContaining({
            enabled: true,
            id: 'gpt-4',
            providerId: 'openai',
            type: 'chat',
          }),
          expect.objectContaining({
            enabled: true,
            id: 'flux/schnell',
            providerId: 'fal',
            type: 'image',
          }),
          expect.objectContaining({
            enabled: true,
            id: 'flux-kontext/dev',
            providerId: 'fal',
            type: 'image',
          }),
        ],
        enabledAiProviders: [
          { id: 'openai', logo: 'openai-logo', name: 'OpenAI', source: 'builtin' },
          { id: 'fal', logo: 'fal-logo', name: 'Fal', source: 'builtin' },
        ],
        enabledChatAiProviders: [
          { id: 'openai', logo: 'openai-logo', name: 'OpenAI', source: 'builtin' },
        ],
        enabledImageAiProviders: [
          expect.objectContaining({
            id: 'fal',
            name: 'Fal',
          }),
        ],
        runtimeConfig: {
          fal: {
            apiKey: 'test-fal-key',
            enabled: undefined,
          },
          openai: {
            apiKey: 'test-openai-key',
            enabled: true,
          },
        },
      });
    });
  });

  describe('getAiProviderDetail', () => {
    it('should merge provider config with user settings', async () => {
      const providerId = 'openai';
      const mockProviderDetail = {
        id: providerId,
        customSetting: 'test',
      } as unknown as AiProviderDetailItem;

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue(mockProviderDetail);

      const result = await repo.getAiProviderDetail(providerId);

      expect(result).toMatchObject({
        id: providerId,
        customSetting: 'test',
        enabled: true, // from mockProviderConfigs
      });
    });

    it('should merge provider configs correctly', async () => {
      const mockProviderDetail = {
        enabled: true,
        id: 'openai',
        keyVaults: { apiKey: 'test-key' },
        name: 'Custom OpenAI',
        settings: {},
        source: 'builtin' as const,
      };

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue(mockProviderDetail);

      const result = await repo.getAiProviderDetail('openai');

      expect(result).toEqual({
        enabled: true,
        id: 'openai',
        keyVaults: { apiKey: 'test-key' },
        name: 'Custom OpenAI',
        settings: {},
        source: 'builtin',
      });
    });
  });

  describe('AiInfraRepos.tryMatchingProviderFrom', () => {
    const createRuntimeState = (models: EnabledAiModel[]): AiProviderRuntimeState => ({
      enabledAiModels: models,
      enabledAiProviders: [],
      enabledChatAiProviders: [],
      enabledImageAiProviders: [],
      runtimeConfig: {},
    });

    it('prefers provider order when multiple providers have model', async () => {
      const runtimeState = createRuntimeState([
        { abilities: {}, enabled: true, id: 'm-1', type: 'chat', providerId: 'provider-b' },
        { abilities: {}, enabled: true, id: 'm-1', type: 'chat', providerId: 'provider-a' },
      ]);

      const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
        modelId: 'm-1',
        preferredProviders: ['provider-b', 'provider-a'],
      });

      expect(providerId).toBe('provider-b');
    });

    it('ignores disabled models when matching', async () => {
      const runtimeState = createRuntimeState([
        { abilities: {}, enabled: false, id: 'm-1', type: 'chat', providerId: 'provider-disabled' },
        { abilities: {}, enabled: true, id: 'm-1', type: 'chat', providerId: 'provider-a' },
      ]);

      const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
        modelId: 'm-1',
        preferredProviders: ['provider-disabled', 'provider-a'],
      });

      expect(providerId).toBe('provider-a');
    });

    it('falls back to provided fallback provider when no match', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const runtimeState = createRuntimeState([]);

      const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
        modelId: 'm-1',
        fallbackProvider: 'provider-fallback',
      });

      expect(providerId).toBe('provider-fallback');
      warnSpy.mockRestore();
    });
  });
});
