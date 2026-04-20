import type { AiProviderListItem } from '@lobechat/types';
import type { EnabledAiModel, ExtendParamsType } from 'model-bank';
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

    // Test scenario: user model abilities is empty (Empty) while the base model has search capability and settings
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
        abilities: { search: false }, // Use builtin abilities
        settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // Use builtin abilities
      expect(merged?.abilities?.search).toEqual(false);
      // Remove builtin settings
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
        abilities: { search: true }, // Use builtin abilities
        settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // Use builtin abilities
      expect(merged?.abilities?.search).toEqual(true);
      // Retain builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'google' });
    });

    // Test scenario: user model has search disabled (abilities.search is undefined) while the base model has search capability and settings
    it('should retain builtin settings when user model has no abilities.search (undefined) and builtin has settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { vision: true }, // Enable vision ability, no search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: { search: false }, // builtin abilities have no effect
        settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // abilities.search remains undefined (backward compatible)
      expect(merged?.abilities?.search).toBeUndefined();
      // Retain builtin settings
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
        abilities: { vision: true }, // Enable vision ability, no search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: { search: true }, // builtin abilities have no effect
        settings: { searchImpl: 'params', searchProvider: 'google' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // abilities.search remains undefined (backward compatible)
      expect(merged?.abilities?.search).toBeUndefined();
      // Retain builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'params', searchProvider: 'google' });
    });

    // Test scenario: user model has search disabled (abilities.search is undefined) and the base model also has no search capability or settings
    it('should retain no settings when user model has no abilities.search (undefined) and builtin has no settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: {}, // no search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: {},
        // builtin has no settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities?.search).toBeUndefined();
      // no settings
      expect(merged?.settings).toBeUndefined();
    });

    // Test: user model has abilities.search: true
    it('should inject defaults when user has search: true, no existing settings (builtin none)', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { search: true }, // user-enabled search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        abilities: {},
        // no settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: true });
      // Inject defaults (openai: params)
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
        settings: { searchImpl: 'tool' }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: true });
      // Use builtin settings
      expect(merged?.settings).toEqual({ searchImpl: 'tool' });
    });

    // Test: user model has abilities.search: false
    it('should remove settings when user has search: false and builtin has settings', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      const userModel: EnabledAiModel = {
        id: 'gpt-4',
        providerId: 'openai',
        enabled: true,
        type: 'chat',
        abilities: { search: false }, // user-disabled search
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        settings: { searchImpl: 'tool', extendParams: [] }, // builtin has settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: false });
      // Remove search-related settings, retain others
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
        // no settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      expect(merged?.abilities).toEqual({ search: false });
      // no settings
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
      // Should use user settings, not builtin
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
        // user has not set settings
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
      // Should use builtin settings
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
        // user has not set settings
      };

      const builtinModel = {
        id: 'gpt-4',
        enabled: true,
        type: 'chat' as const,
        // builtin also has no settings
      };

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([userModel]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([builtinModel]);

      const result = await repo.getEnabledModels();

      const merged = result.find((m) => m.id === 'gpt-4');
      expect(merged).toBeDefined();
      // no settings
      expect(merged?.settings).toBeUndefined();
    });

    it('should treat sort=0 as a valid sort value (not fallback to undefined)', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', sort: 1, source: 'builtin' as const },
      ];

      const mockAllModels = [
        {
          abilities: {},
          enabled: true,
          id: 'gpt-4',
          providerId: 'openai',
          sort: 0,
          type: 'chat' as const,
        },
      ] as EnabledAiModel[];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(mockAllModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        { enabled: true, id: 'gpt-4', type: 'chat' as const },
      ]);

      const result = await repo.getEnabledModels();
      const model = result.find((m) => m.id === 'gpt-4');

      expect(model?.sort).toBe(0);
    });

    it('should sort unsorted models after sorted ones', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', sort: 1, source: 'builtin' as const },
      ];

      const mockAllModels = [
        { enabled: true, id: 'gpt-4', providerId: 'openai', sort: 2, type: 'chat' as const },
        { enabled: true, id: 'gpt-3', providerId: 'openai', sort: 0, type: 'chat' as const },
        // No sort value - should appear last
        { enabled: true, id: 'gpt-new', providerId: 'openai', type: 'chat' as const },
      ] as EnabledAiModel[];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(mockAllModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        { enabled: true, id: 'gpt-4', type: 'chat' as const },
        { enabled: true, id: 'gpt-3', type: 'chat' as const },
        { enabled: true, id: 'gpt-new', type: 'chat' as const },
      ]);

      const result = await repo.getEnabledModels();
      const ids = result.map((m) => m.id);

      // gpt-3 (sort=0) < gpt-4 (sort=2) < gpt-new (no sort, goes to end)
      expect(ids).toEqual(['gpt-3', 'gpt-4', 'gpt-new']);
    });

    it('should inject searchImpl for unmodified builtin model with search: true', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      // No user models in DB at all
      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          id: 'gpt-4',
          enabled: true,
          type: 'chat' as const,
          abilities: { search: true },
          // no settings
        },
      ]);

      const result = await repo.getEnabledModels();

      const model = result.find((m) => m.id === 'gpt-4');
      expect(model).toBeDefined();
      expect(model?.abilities).toMatchObject({ search: true });
      // Should inject searchImpl even though user never modified this model
      expect(model?.settings).toEqual({ searchImpl: 'params' });
    });

    it('should not inject searchImpl for unmodified builtin model without search ability', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue([]);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        {
          id: 'gpt-4',
          enabled: true,
          type: 'chat' as const,
          abilities: { reasoning: true },
          // no search, no settings
        },
      ]);

      const result = await repo.getEnabledModels();

      const model = result.find((m) => m.id === 'gpt-4');
      expect(model).toBeDefined();
      expect(model?.abilities?.search).toBeUndefined();
      expect(model?.settings).toBeUndefined();
    });

    it('should produce consistent searchImpl between modified and unmodified models', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', source: 'builtin' as const },
      ];

      // User only modified model-a (e.g. changed displayName), not model-b
      const userModels: EnabledAiModel[] = [
        {
          id: 'model-a',
          providerId: 'openai',
          enabled: true,
          type: 'chat',
          abilities: {},
          displayName: 'Custom A',
        },
      ];

      // Both builtin models have search: true but no searchImpl
      const builtinModels = [
        {
          id: 'model-a',
          enabled: true,
          type: 'chat' as const,
          abilities: { search: true },
        },
        {
          id: 'model-b',
          enabled: true,
          type: 'chat' as const,
          abilities: { search: true },
        },
      ];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(userModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue(builtinModels);

      const result = await repo.getEnabledModels();

      const modelA = result.find((m) => m.id === 'model-a');
      const modelB = result.find((m) => m.id === 'model-b');

      expect(modelA).toBeDefined();
      expect(modelB).toBeDefined();
      // Both should have searchImpl injected, regardless of whether user modified them
      expect(modelA?.settings?.searchImpl).toBe('params');
      expect(modelB?.settings?.searchImpl).toBe('params');
    });

    it('should deduplicate models that exist in both builtin and user DB', async () => {
      const mockProviders = [
        { enabled: true, id: 'openai', name: 'OpenAI', sort: 1, source: 'builtin' as const },
      ];

      // gpt-4 exists in both builtin list and user DB
      const mockAllModels = [
        {
          enabled: true,
          id: 'gpt-4',
          providerId: 'openai',
          displayName: 'User GPT-4',
          sort: 1,
          type: 'chat' as const,
        },
        {
          enabled: true,
          id: 'custom-model',
          providerId: 'openai',
          displayName: 'Custom Model',
          type: 'chat' as const,
        },
      ] as EnabledAiModel[];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);
      vi.spyOn(repo.aiModelModel, 'getAllModels').mockResolvedValue(mockAllModels);
      vi.spyOn(repo as any, 'fetchBuiltinModels').mockResolvedValue([
        { enabled: true, id: 'gpt-4', displayName: 'GPT-4', type: 'chat' as const },
      ]);

      const result = await repo.getEnabledModels();

      // gpt-4 should only appear once (from builtin merge path), not duplicated
      const gpt4Models = result.filter((m) => m.id === 'gpt-4');
      expect(gpt4Models).toHaveLength(1);
      // The merged one should have user's displayName
      expect(gpt4Models[0].displayName).toBe('User GPT-4');

      // custom-model should still be included as appended user model
      expect(result.find((m) => m.id === 'custom-model')).toBeDefined();
    });
  });
});
