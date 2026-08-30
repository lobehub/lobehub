import { beforeEach, describe, expect, it, vi } from 'vitest';

import { imageGenerationExecutor } from './index';

const mocks = vi.hoisted(() => ({
  createImage: vi.fn(),
  createTopic: vi.fn(),
  enabledImageModelList: vi.fn(),
  getAgentProjectionById: vi.fn(),
  getAiProviderModelList: vi.fn(),
  getAiProviderRuntimeState: vi.fn(),
  loadDefaultHiddenBuiltinModels: vi.fn(),
}));

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadDefaultHiddenBuiltinModels: mocks.loadDefaultHiddenBuiltinModels,
}));
vi.mock('@/services/aiModel', () => ({
  aiModelService: {
    getAiProviderModelList: mocks.getAiProviderModelList,
  },
}));
vi.mock('@/services/aiProvider', () => ({
  aiProviderService: {
    getAiProviderRuntimeState: mocks.getAiProviderRuntimeState,
  },
}));
vi.mock('@/services/generation', () => ({
  generationService: {},
}));
vi.mock('@/services/generationTopic', () => ({
  generationTopicService: {
    createTopic: mocks.createTopic,
  },
}));
vi.mock('@/services/image', () => ({
  imageService: {
    createImage: mocks.createImage,
  },
}));
vi.mock('@/projection/modules/agent/read', () => ({
  getAgentProjectionById: mocks.getAgentProjectionById,
}));
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: mocks.enabledImageModelList,
  },
  getAiInfraStoreState: vi.fn(() => ({})),
}));

describe('ImageGenerationExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentProjectionById.mockImplementation((agentId) =>
      agentId === 'agent-public' ? { id: agentId, visibility: 'public' } : undefined,
    );
    mocks.enabledImageModelList.mockReturnValue([
      {
        children: [{ id: 'image-model-1' }],
        id: 'provider-1',
        name: 'Provider 1',
      },
    ]);
    mocks.loadDefaultHiddenBuiltinModels.mockResolvedValue([]);
    mocks.createTopic.mockResolvedValue('topic-1');
    mocks.createImage.mockResolvedValue({
      data: {
        batch: { id: 'batch-1' },
        generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }],
      },
      success: true,
    });
  });

  it('preserves public agent visibility for client-routed image topics', async () => {
    const result = await imageGenerationExecutor.generateImage(
      {
        model: 'image-model-1',
        prompt: 'A shared workspace illustration',
        provider: 'provider-1',
        waitUntilComplete: false,
      },
      {
        agentId: 'agent-public',
        messageId: 'message-1',
      },
    );

    expect(result.success).toBe(true);
    expect(mocks.createTopic).toHaveBeenCalledWith(
      'image',
      'public',
      'A shared workspace illustration',
    );
  });

  it('does not expose hidden models while the store model list is hydrating', async () => {
    mocks.enabledImageModelList.mockReturnValue([]);
    mocks.getAiProviderRuntimeState.mockResolvedValue({
      enabledImageAiProviders: [{ id: 'lobehub', name: 'LobeHub' }],
      hiddenBuiltinModels: [{ id: 'hidden-image', providerId: 'lobehub' }],
    });
    mocks.getAiProviderModelList.mockImplementation(
      async (_providerId: string, options: { limit?: number }) => {
        const models = [{ id: 'hidden-image' }, { id: 'visible-image' }];

        return typeof options.limit === 'number' ? models.slice(0, options.limit) : models;
      },
    );

    const result = await imageGenerationExecutor.listImageModels({
      limit: 1,
      provider: 'lobehub',
    });

    expect(result).toMatchObject({
      state: {
        providers: [
          {
            id: 'lobehub',
            models: [{ id: 'visible-image' }],
          },
        ],
        totalModels: 1,
      },
      success: true,
    });
  });

  it('uses the client default blocklist with an older runtime-state response', async () => {
    mocks.enabledImageModelList.mockReturnValue([]);
    mocks.getAiProviderRuntimeState.mockResolvedValue({
      enabledImageAiProviders: [{ id: 'lobehub', name: 'LobeHub' }],
    });
    mocks.loadDefaultHiddenBuiltinModels.mockResolvedValue([
      { id: 'hidden-image', providerId: 'lobehub' },
    ]);
    mocks.getAiProviderModelList.mockResolvedValue([
      { id: 'hidden-image' },
      { id: 'visible-image' },
    ]);

    const result = await imageGenerationExecutor.listImageModels({
      limit: 1,
      provider: 'lobehub',
    });

    expect(result).toMatchObject({
      state: {
        providers: [{ id: 'lobehub', models: [{ id: 'visible-image' }] }],
        totalModels: 1,
      },
      success: true,
    });
  });

  it('fails closed when the runtime-state policy is unresolved', async () => {
    mocks.enabledImageModelList.mockReturnValue([]);
    mocks.getAiProviderRuntimeState.mockResolvedValue({
      enabledImageAiProviders: [{ id: 'lobehub', name: 'LobeHub' }],
      hiddenBuiltinModelsResolved: false,
    });

    const result = await imageGenerationExecutor.listImageModels({
      limit: 1,
      provider: 'lobehub',
    });

    expect(result).toMatchObject({
      state: { providers: [], totalModels: 0 },
      success: true,
    });
    expect(mocks.getAiProviderModelList).not.toHaveBeenCalled();
  });
});
