import { describe, expect, it, vi } from 'vitest';

import { AiModelModel } from '@/database/models/aiModel';
import { AiInfraRepos } from '@/database/repositories/aiInfra';

import { aiModelRouter } from '../aiModel';

vi.mock('@/database/models/aiModel');
vi.mock('@/database/models/user');
vi.mock('@/database/repositories/aiInfra');
vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: vi.fn().mockReturnValue({
    aiProvider: {},
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    }),
  },
}));

describe('aiModelRouter', () => {
  const mockCtx = {
    userId: 'test-user',
  };

  it('should create ai model', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'model-1' });
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          create: mockCreate,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    const result = await caller.createAiModel({
      id: 'test-model',
      providerId: 'test-provider',
    });

    expect(result).toBe('model-1');
    expect(mockCreate).toHaveBeenCalledWith({
      id: 'test-model',
      providerId: 'test-provider',
    });
  });

  it('should get ai model by id', async () => {
    const mockModel = {
      id: 'model-1',
      name: 'Test Model',
    };
    const mockFindById = vi.fn().mockResolvedValue(mockModel);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          findById: mockFindById,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    const result = await caller.getAiModelById({ id: 'model-1' });

    expect(result).toEqual(mockModel);
    expect(mockFindById).toHaveBeenCalledWith('model-1');
  });

  it('should get ai provider model list', async () => {
    const mockModelList = [
      { id: 'model-1', name: 'Model 1' },
      { id: 'model-2', name: 'Model 2' },
    ];
    const mockGetList = vi.fn().mockResolvedValue(mockModelList);
    vi.mocked(AiInfraRepos).mockImplementation(
      () =>
        ({
          getAiProviderModelList: mockGetList,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    const result = await caller.getAiProviderModelList({ id: 'provider-1' });

    expect(result).toEqual(mockModelList);
    expect(mockGetList).toHaveBeenCalledWith('provider-1', {
      enabled: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('should remove ai model', async () => {
    const mockDelete = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          delete: mockDelete,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.removeAiModel({
      id: 'model-1',
      providerId: 'provider-1',
    });

    expect(mockDelete).toHaveBeenCalledWith('model-1', 'provider-1');
  });

  it('should update ai model', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          update: mockUpdate,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.updateAiModel({
      id: 'model-1',
      providerId: 'provider-1',
      value: {
        displayName: 'Updated Model',
      },
    });

    expect(mockUpdate).toHaveBeenCalledWith('model-1', 'provider-1', {
      displayName: 'Updated Model',
    });
  });

  it('should toggle model enabled status', async () => {
    const mockToggle = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          toggleModelEnabled: mockToggle,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.toggleModelEnabled({
      id: 'model-1',
      providerId: 'provider-1',
      enabled: true,
      type: 'embedding',
    });

    expect(mockToggle).toHaveBeenCalledWith({
      id: 'model-1',
      providerId: 'provider-1',
      enabled: true,
      type: 'embedding',
    });
  });

  it('should batch toggle ai models', async () => {
    const mockBatchToggle = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          batchToggleAiModels: mockBatchToggle,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.batchToggleAiModels({
      id: 'provider-1',
      models: ['model-1', 'model-2'],
      enabled: true,
    });

    expect(mockBatchToggle).toHaveBeenCalledWith('provider-1', ['model-1', 'model-2'], true);
  });

  it('should batch update ai models', async () => {
    const mockBatchUpdate = vi.fn().mockResolvedValue([]);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          batchUpdateAiModels: mockBatchUpdate,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.batchUpdateAiModels({
      id: 'provider-1',
      models: [{ id: 'model-1' }, { id: 'model-2' }],
    });

    expect(mockBatchUpdate).toHaveBeenCalledWith('provider-1', [
      { id: 'model-1' },
      { id: 'model-2' },
    ]);
  });

  it('should clear models by provider', async () => {
    const mockClear = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          clearModelsByProvider: mockClear,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.clearModelsByProvider({
      providerId: 'provider-1',
    });

    expect(mockClear).toHaveBeenCalledWith('provider-1');
  });

  it('should clear remote models', async () => {
    const mockClearRemote = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(
      () =>
        ({
          clearRemoteModels: mockClearRemote,
        }) as any,
    );

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.clearRemoteModels({
      providerId: 'provider-1',
    });

    expect(mockClearRemote).toHaveBeenCalledWith('provider-1');
  });
});
