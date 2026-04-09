import type { AiProviderModelListItem } from 'model-bank';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { AiInfraRepos } from '../index';

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

    it('should preserve builtin model type when DB record has wrong type (e.g. video model stored as chat)', async () => {
      const providerId = 'openai';

      // DB record from remote fetch incorrectly defaulted to 'chat'
      const userModels: AiProviderModelListItem[] = [
        {
          id: 'sora-2',
          type: 'chat',
          enabled: true,
        },
      ];

      // Builtin correctly defines it as 'video'
      const builtinModels: AiProviderModelListItem[] = [
        {
          id: 'sora-2',
          type: 'video',
          enabled: true,
        } as AiProviderModelListItem,
      ];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const merged = result.find((m) => m.id === 'sora-2');
      expect(merged).toBeDefined();
      expect(merged!.type).toBe('video');
    });

    it('should preserve builtin type for all model types (image, embedding, tts, stt)', async () => {
      const providerId = 'openai';

      // DB records all incorrectly stored as 'chat'
      const userModels: AiProviderModelListItem[] = [
        { id: 'dall-e-3', type: 'chat', enabled: true },
        { id: 'text-embedding-3-small', type: 'chat', enabled: true },
        { id: 'tts-1', type: 'chat', enabled: true },
        { id: 'whisper-1', type: 'chat', enabled: true },
      ] as AiProviderModelListItem[];

      const builtinModels: AiProviderModelListItem[] = [
        { id: 'dall-e-3', type: 'image', enabled: true },
        { id: 'text-embedding-3-small', type: 'embedding', enabled: true },
        { id: 'tts-1', type: 'tts', enabled: true },
        { id: 'whisper-1', type: 'stt', enabled: true },
      ] as AiProviderModelListItem[];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      expect(result.find((m) => m.id === 'dall-e-3')!.type).toBe('image');
      expect(result.find((m) => m.id === 'text-embedding-3-small')!.type).toBe('embedding');
      expect(result.find((m) => m.id === 'tts-1')!.type).toBe('tts');
      expect(result.find((m) => m.id === 'whisper-1')!.type).toBe('stt');
    });

    it('should keep user type for custom models not in builtin list', async () => {
      const providerId = 'openai';

      const userModels: AiProviderModelListItem[] = [
        { id: 'my-custom-model', type: 'chat', enabled: true },
      ] as AiProviderModelListItem[];

      // Builtin list does not contain this model
      const builtinModels: AiProviderModelListItem[] = [
        { id: 'gpt-4', type: 'chat', enabled: true },
      ] as AiProviderModelListItem[];

      vi.spyOn(repo.aiModelModel, 'getModelListByProviderId').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getAiProviderModelList(providerId);

      const custom = result.find((m) => m.id === 'my-custom-model');
      expect(custom).toBeDefined();
      expect(custom!.type).toBe('chat');
    });
  });
});
