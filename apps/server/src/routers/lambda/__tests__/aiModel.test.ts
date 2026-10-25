import type { ComfyUIWorkflow, CreateAiModelParams, UpdateAiModelParams } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiModelModel } from '@/database/models/aiModel';
import { AiInfraRepos } from '@/database/repositories/aiInfra';

import { aiModelRouter } from '../aiModel';

const mockGetHiddenBuiltinModelsForUser = vi.hoisted(() => vi.fn());

vi.mock('@/business/server/aiProvider', () => ({
  getHiddenBuiltinModelsForUser: mockGetHiddenBuiltinModelsForUser,
  getModelRedirects: vi.fn(async () => ({})),
}));
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

const importedWorkflow: ComfyUIWorkflow = {
  bindings: { prompt: [{ input: 'prompt', nodeId: 'save' }] },
  graph: { save: { class_type: 'CustomImageEmitter', inputs: { prompt: 'saved', steps: 31 } } },
  output: { imageIndex: 0, nodeId: 'save' },
  version: 1,
};

describe('aiModelRouter', () => {
  const mockCtx = {
    userId: 'test-user',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue([]);
  });

  it('should create ai model', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'model-1' });
    const mockFindByIdAndProvider = vi.fn().mockResolvedValue(null);
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        create: mockCreate,
        findByIdAndProvider: mockFindByIdAndProvider,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    const result = await caller.createAiModel({
      id: 'test-model',
      providerId: 'test-provider',
    });

    expect(result).toBe('model-1');
    expect(mockFindByIdAndProvider).toHaveBeenCalledWith('test-model', 'test-provider');
    expect(mockCreate).toHaveBeenCalledWith({
      id: 'test-model',
      providerId: 'test-provider',
    });
  });

  it('should reject duplicate ai model before creating', async () => {
    const mockCreate = vi.fn();
    const mockFindByIdAndProvider = vi.fn().mockResolvedValue({ id: 'test-model' });
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        create: mockCreate,
        findByIdAndProvider: mockFindByIdAndProvider,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    await expect(
      caller.createAiModel({
        id: 'test-model',
        providerId: 'test-provider',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Model "test-model" already exists',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should convert duplicate insert races to conflict errors', async () => {
    const duplicateError = Object.assign(new Error('failed query'), {
      cause: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'ai_models_id_provider_id_user_id_pk',
      }),
    });
    const mockCreate = vi.fn().mockRejectedValue(duplicateError);
    const mockFindByIdAndProvider = vi.fn().mockResolvedValue(null);
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        create: mockCreate,
        findByIdAndProvider: mockFindByIdAndProvider,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    await expect(
      caller.createAiModel({
        id: 'test-model',
        providerId: 'test-provider',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Model "test-model" already exists',
    });
  });

  it('should get ai model by id', async () => {
    const mockModel = {
      id: 'model-1',
      name: 'Test Model',
    };
    const mockFindById = vi.fn().mockResolvedValue(mockModel);
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        findById: mockFindById,
      } as any;
    });

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
    vi.mocked(AiInfraRepos).mockImplementation(function () {
      return {
        getAiProviderModelList: mockGetList,
      } as any;
    });

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
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        delete: mockDelete,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.removeAiModel({
      id: 'model-1',
      providerId: 'provider-1',
    });

    expect(mockDelete).toHaveBeenCalledWith('model-1', 'provider-1');
  });

  it('should update ai model', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        update: mockUpdate,
      } as any;
    });

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

  it('creates imported image models with controls derived only from graph bindings', async () => {
    const persisted: { value?: CreateAiModelParams } = {};
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        create: async (value: CreateAiModelParams) => {
          persisted.value = value;
          return { id: value.id };
        },
        findByIdAndProvider: async () => undefined,
      } as unknown as AiModelModel;
    });
    const caller = aiModelRouter.createCaller(mockCtx);
    expect(
      await caller.createAiModel({
        config: { comfyuiWorkflow: importedWorkflow },
        id: 'comfyui/workflow-test',
        parameters: {
          prompt: { default: 'client default' },
          width: { default: 999, max: 999, min: 1 },
        },
        providerId: 'comfyui',
        type: 'image',
      }),
    ).toBe('comfyui/workflow-test');
    expect(persisted.value?.config?.comfyuiWorkflow).toEqual(importedWorkflow);
    expect(persisted.value?.parameters).toEqual({ prompt: { default: 'saved' } });
  });

  it('keeps saved imported controls authoritative when a generic update supplies parameters without a graph', async () => {
    const persisted: { value?: UpdateAiModelParams } = {};
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        findByIdAndProvider: async () => ({
          config: { comfyuiWorkflow: importedWorkflow },
          source: 'custom',
          type: 'image',
        }),
        update: async (_id: string, _provider: string, value: UpdateAiModelParams) => {
          persisted.value = value;
        },
      } as unknown as AiModelModel;
    });
    const caller = aiModelRouter.createCaller(mockCtx);
    await caller.updateAiModel({
      id: 'comfyui/workflow-test',
      providerId: 'comfyui',
      value: {
        parameters: {
          prompt: { default: 'client default' },
          width: { default: 999, max: 999, min: 1 },
        },
      },
    });
    expect(persisted.value?.parameters).toEqual({ prompt: { default: 'saved' } });
    expect(persisted.value?.config).toBeUndefined();
  });

  it('does not overwrite a bundled ComfyUI model with an imported graph', async () => {
    const update = vi.fn();
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        findByIdAndProvider: async () => ({ source: 'builtin', type: 'image' }),
        update,
      } as unknown as AiModelModel;
    });
    const caller = aiModelRouter.createCaller(mockCtx);
    await expect(
      caller.updateAiModel({
        id: 'comfyui/stable-diffusion-xl',
        providerId: 'comfyui',
        value: { config: { comfyuiWorkflow: importedWorkflow } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(update).not.toHaveBeenCalled();
  });

  it('should toggle model enabled status', async () => {
    const mockToggle = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        toggleModelEnabled: mockToggle,
      } as any;
    });

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
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        batchToggleAiModels: mockBatchToggle,
      } as any;
    });

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
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        batchUpdateAiModels: mockBatchUpdate,
      } as any;
    });

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
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        clearModelsByProvider: mockClear,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.clearModelsByProvider({
      providerId: 'provider-1',
    });

    expect(mockClear).toHaveBeenCalledWith('provider-1');
  });

  it('should clear remote models', async () => {
    const mockClearRemote = vi.fn().mockResolvedValue(true);
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        clearRemoteModels: mockClearRemote,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.clearRemoteModels({
      providerId: 'provider-1',
    });

    expect(mockClearRemote).toHaveBeenCalledWith('provider-1');
  });

  it('should get model reasoning config', async () => {
    const mockGet = vi.fn().mockResolvedValue({ gpt5_6ReasoningEffort: 'high' });
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        getModelReasoningConfig: mockGet,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    const result = await caller.getAiModelReasoningConfig({
      id: 'gpt-5.6-sol',
      providerId: 'openai',
    });

    expect(mockGet).toHaveBeenCalledWith('gpt-5.6-sol', 'openai');
    expect(result).toEqual({ gpt5_6ReasoningEffort: 'high' });
  });

  it('should update model reasoning config', async () => {
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        updateModelReasoningConfig: mockUpdate,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    await caller.updateAiModelReasoningConfig({
      id: 'gpt-5.6-sol',
      providerId: 'openai',
      value: { gpt5_6ReasoningEffort: 'xhigh', reasoningMode: 'pro' },
    });

    expect(mockUpdate).toHaveBeenCalledWith('gpt-5.6-sol', 'openai', {
      gpt5_6ReasoningEffort: 'xhigh',
      reasoningMode: 'pro',
    });
  });

  it('should reject invalid reasoning config values', async () => {
    const mockUpdate = vi.fn();
    vi.mocked(AiModelModel).mockImplementation(function () {
      return {
        updateModelReasoningConfig: mockUpdate,
      } as any;
    });

    const caller = aiModelRouter.createCaller(mockCtx);

    await expect(
      caller.updateAiModelReasoningConfig({
        id: 'gpt-5.6-sol',
        providerId: 'openai',
        value: { gpt5_6ReasoningEffort: 'ultra' } as any,
      }),
    ).rejects.toThrow();

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
