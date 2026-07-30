import type { AiProviderRuntimeState } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getUserScopedAiProviderModelList,
  getUserScopedAiProviderRuntimeState,
} from './aiProviderAccess';

const mockGetHiddenBuiltinModelsForUser = vi.hoisted(() => vi.fn());
const mockGetModelRedirects = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('@/business/server/aiProvider', () => ({
  getHiddenBuiltinModelsForUser: mockGetHiddenBuiltinModelsForUser,
  getModelRedirects: mockGetModelRedirects,
}));

describe('getUserScopedAiProviderModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters hidden models before applying pagination without mutating cached data', async () => {
    const models = [{ id: 'hidden-model' }, { id: 'visible-model-1' }, { id: 'visible-model-2' }];
    const loadModelList = vi.fn().mockResolvedValue(models);
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue([
      { id: 'hidden-model', providerId: 'lobehub' },
    ]);

    const result = await getUserScopedAiProviderModelList(
      'user-1',
      'lobehub',
      { enabled: false, limit: 1, offset: 1, type: 'chat' },
      loadModelList,
    );

    expect(loadModelList).toHaveBeenCalledWith({
      enabled: false,
      limit: undefined,
      offset: undefined,
      type: 'chat',
    });
    expect(result).toEqual([{ id: 'visible-model-2' }]);
    expect(models).toHaveLength(3);
  });

  it('preserves the repository query when the provider has no hidden models', async () => {
    const models = [{ id: 'visible-model' }];
    const loadModelList = vi.fn().mockResolvedValue(models);
    const options = { enabled: true, limit: 20, offset: 10, type: 'image' };
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue([
      { id: 'hidden-model', providerId: 'lobehub' },
    ]);

    const result = await getUserScopedAiProviderModelList(
      'user-1',
      'openai',
      options,
      loadModelList,
    );

    expect(loadModelList).toHaveBeenCalledWith(options);
    expect(result).toBe(models);
  });

  it('fails closed without reading cached models when access cannot be resolved', async () => {
    const loadModelList = vi.fn();
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue(undefined);

    const result = await getUserScopedAiProviderModelList('user-1', 'lobehub', {}, loadModelList);

    expect(result).toEqual([]);
    expect(loadModelList).not.toHaveBeenCalled();
  });
});

describe('getUserScopedAiProviderRuntimeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters hidden models and model-type providers for server consumers', async () => {
    const lobehubProvider = { id: 'lobehub', source: 'builtin' as const };
    const openaiProvider = { id: 'openai', source: 'builtin' as const };
    const hiddenChatModel = {
      abilities: {},
      id: 'hidden-chat',
      providerId: 'lobehub',
      type: 'chat' as const,
    };
    const visibleImageModel = {
      abilities: {},
      id: 'visible-image',
      providerId: 'openai',
      type: 'image' as const,
    };
    const runtimeState: AiProviderRuntimeState = {
      enabledAiModels: [hiddenChatModel, visibleImageModel],
      enabledAiProviders: [lobehubProvider, openaiProvider],
      enabledChatAiProviders: [lobehubProvider],
      enabledImageAiProviders: [openaiProvider],
      enabledVideoAiProviders: [],
      runtimeConfig: {},
    };
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue([
      { id: 'hidden-chat', providerId: 'lobehub' },
    ]);

    const result = await getUserScopedAiProviderRuntimeState('user-1', async () => runtimeState);

    expect(result).toEqual({
      ...runtimeState,
      enabledAiModels: [visibleImageModel],
      enabledChatAiProviders: [],
      hiddenBuiltinModels: [{ id: 'hidden-chat', providerId: 'lobehub' }],
      modelRedirects: {},
    });
  });

  it('delivers business model redirects with the runtime state', async () => {
    const runtimeState: AiProviderRuntimeState = {
      enabledAiModels: [],
      enabledAiProviders: [],
      enabledChatAiProviders: [],
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      runtimeConfig: {},
    };
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue([]);
    mockGetModelRedirects.mockResolvedValue({ 'lobehub/old-model': 'new-model' });

    const result = await getUserScopedAiProviderRuntimeState('user-1', async () => runtimeState);

    expect(result.modelRedirects).toEqual({ 'lobehub/old-model': 'new-model' });
  });

  it('drops redirect entries whose successor is hidden from the user', async () => {
    const runtimeState: AiProviderRuntimeState = {
      enabledAiModels: [],
      enabledAiProviders: [],
      enabledChatAiProviders: [],
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      runtimeConfig: {},
    };
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue([
      { id: 'beta-successor', providerId: 'lobehub' },
    ]);
    mockGetModelRedirects.mockResolvedValue({
      'lobehub/old-beta': 'beta-successor',
      'lobehub/old-model': 'new-model',
    });

    const result = await getUserScopedAiProviderRuntimeState('user-1', async () => runtimeState);

    expect(result.modelRedirects).toEqual({ 'lobehub/old-model': 'new-model' });
  });

  it('withholds redirects when model access cannot be resolved', async () => {
    const runtimeState: AiProviderRuntimeState = {
      enabledAiModels: [],
      enabledAiProviders: [],
      enabledChatAiProviders: [],
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      runtimeConfig: {},
    };
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue(undefined);
    mockGetModelRedirects.mockResolvedValue({ 'lobehub/old-model': 'new-model' });

    const result = await getUserScopedAiProviderRuntimeState('user-1', async () => runtimeState);

    expect(result.modelRedirects).toEqual({});
  });

  it('fails closed when model access cannot be resolved', async () => {
    const provider = { id: 'lobehub', source: 'builtin' as const };
    const runtimeState: AiProviderRuntimeState = {
      enabledAiModels: [
        {
          abilities: {},
          id: 'possibly-hidden-chat',
          providerId: 'lobehub',
          type: 'chat',
        },
      ],
      enabledAiProviders: [provider],
      enabledChatAiProviders: [provider],
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      runtimeConfig: {},
    };
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue(undefined);

    const result = await getUserScopedAiProviderRuntimeState('user-1', async () => runtimeState);

    expect(result).toMatchObject({
      enabledAiModels: [],
      enabledChatAiProviders: [],
      enabledImageAiProviders: [],
      enabledVideoAiProviders: [],
      hiddenBuiltinModelsResolved: false,
      runtimeConfig: {},
    });
    expect(result).not.toHaveProperty('hiddenBuiltinModels');
  });

  it('stops server runtimes when model access cannot be resolved', async () => {
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue(undefined);

    await expect(
      getUserScopedAiProviderRuntimeState(
        'user-1',
        async () => ({
          enabledAiModels: [],
          enabledAiProviders: [],
          enabledChatAiProviders: [],
          enabledImageAiProviders: [],
          enabledVideoAiProviders: [],
          runtimeConfig: { lobehub: {} as never },
        }),
        { throwOnUnresolvedAccess: true },
      ),
    ).rejects.toThrow('Unable to resolve user-scoped model access');
  });
});
