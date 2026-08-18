import { beforeEach, describe, expect, it, vi } from 'vitest';

import { imageGenerationRuntime } from '../imageGeneration';

const callerMocks = vi.hoisted(() => ({
  aiModel: vi.fn(() => ({})),
  aiProvider: vi.fn(() => ({})),
  generation: vi.fn(() => ({})),
  generationTopic: vi.fn(() => ({})),
  image: vi.fn(() => ({})),
}));

const billingMocks = vi.hoisted(() => ({
  getOrCreateUserWallet: vi.fn(),
}));

vi.mock('@/database/models/aicoBilling', () => ({
  AicoBillingModel: vi.fn(() => ({
    getOrCreateUserWallet: billingMocks.getOrCreateUserWallet,
  })),
}));

vi.mock('@/server/routers/lambda/aiModel', () => ({
  aiModelRouter: { createCaller: callerMocks.aiModel },
}));
vi.mock('@/server/routers/lambda/aiProvider', () => ({
  aiProviderRouter: { createCaller: callerMocks.aiProvider },
}));
vi.mock('@/server/routers/lambda/generation', () => ({
  generationRouter: { createCaller: callerMocks.generation },
}));
vi.mock('@/server/routers/lambda/generationTopic', () => ({
  generationTopicRouter: { createCaller: callerMocks.generationTopic },
}));
vi.mock('@/server/routers/lambda/image', () => ({
  imageRouter: { createCaller: callerMocks.image },
}));

const factoryContext = {
  clientIp: '203.0.113.7',
  serverDB: {} as never,
  toolManifestMap: {},
  userId: 'user-1',
  workspaceId: 'workspace-1',
};

describe('imageGenerationRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callerMocks.aiModel.mockReturnValue({});
    callerMocks.aiProvider.mockReturnValue({});
    callerMocks.generation.mockReturnValue({});
    callerMocks.generationTopic.mockReturnValue({});
    callerMocks.image.mockReturnValue({});
    billingMocks.getOrCreateUserWallet.mockResolvedValue({
      preferredBillingSource: 'personal',
      preferredOrganizationId: null,
    });
  });

  it('passes the request and workspace scope to every router caller', async () => {
    await imageGenerationRuntime.factory(factoryContext);

    const callerContext = {
      clientIp: '203.0.113.7',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    };
    expect(callerMocks.aiModel).toHaveBeenCalledWith(callerContext);
    expect(callerMocks.aiProvider).toHaveBeenCalledWith(callerContext);
    expect(callerMocks.generation).toHaveBeenCalledWith(callerContext);
    expect(callerMocks.generationTopic).toHaveBeenCalledWith(callerContext);
    expect(callerMocks.image).toHaveBeenCalledWith(callerContext);
  });

  it('preserves public agent visibility for generated image topics', async () => {
    const createTopic = vi.fn().mockResolvedValue('topic-1');
    callerMocks.generationTopic.mockReturnValue({ createTopic });
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [{ id: 'openrouter', name: 'OpenRouter' }],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn().mockResolvedValue([{ id: 'image-model-1' }]),
    });
    callerMocks.image.mockReturnValue({
      createImage: vi.fn().mockResolvedValue({
        data: {
          batch: { id: 'batch-1' },
          generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }],
        },
        success: true,
      }),
    });

    const runtime = await imageGenerationRuntime.factory({
      ...factoryContext,
      agentVisibility: 'public',
    });

    const result = await runtime.generateImage({
      prompt: 'A shared workspace illustration',
      waitUntilComplete: false,
    });

    expect(result.success).toBe(true);
    expect(createTopic).toHaveBeenCalledWith({
      title: 'A shared workspace illustration',
      type: 'image',
      visibility: 'public',
    });
  });

  it('passes stored wallet billing into createImage', async () => {
    const createImage = vi.fn().mockResolvedValue({
      data: {
        batch: { id: 'batch-1' },
        generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }],
      },
      success: true,
    });
    billingMocks.getOrCreateUserWallet.mockResolvedValue({
      preferredBillingSource: 'organization',
      preferredOrganizationId: 'org_9',
    });
    callerMocks.generationTopic.mockReturnValue({
      createTopic: vi.fn().mockResolvedValue('topic-1'),
    });
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [{ id: 'openrouter', name: 'OpenRouter' }],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn().mockResolvedValue([{ id: 'or-image' }]),
    });
    callerMocks.image.mockReturnValue({ createImage });

    const runtime = await imageGenerationRuntime.factory(factoryContext);

    await runtime.generateImage({
      prompt: 'Wallet-backed photo',
      waitUntilComplete: false,
    });

    expect(createImage).toHaveBeenCalledWith(
      expect.objectContaining({
        aicoBilling: { organizationId: 'org_9', source: 'organization' },
      }),
    );
  });

  it('preserves model descriptions and complete parameter schemas', async () => {
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [{ id: 'openrouter', name: 'OpenRouter' }],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn().mockResolvedValue([
        {
          description: 'A fast image generation and editing model.',
          displayName: 'Image Model 1',
          enabled: true,
          id: 'image-model-1',
          parameters: {
            prompt: { default: '' },
            resolution: {
              default: '1K',
              enum: ['512', '1K', '2K', '4K'],
            },
          },
          type: 'image',
        },
      ]),
    });

    const runtime = await imageGenerationRuntime.factory(factoryContext);

    const result = await runtime.listImageModels({ provider: 'openrouter' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Description: A fast image generation and editing model.');
    expect(result.state).toMatchObject({
      providers: [
        {
          models: [
            {
              description: 'A fast image generation and editing model.',
              parameters: {
                resolution: {
                  enum: ['512', '1K', '2K', '4K'],
                },
              },
            },
          ],
        },
      ],
    });
  });

  it('does not list models hidden for the current user', async () => {
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [{ id: 'openrouter', name: 'OpenRouter' }],
        hiddenBuiltinModels: [{ id: 'hidden-image', providerId: 'openrouter' }],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn(async ({ limit }: { limit?: number }) => {
        const models = [{ id: 'hidden-image' }, { id: 'visible-image' }];
        return typeof limit === 'number' ? models.slice(0, limit) : models;
      }),
    });

    const runtime = await imageGenerationRuntime.factory(factoryContext);

    const result = await runtime.listImageModels({ limit: 1, provider: 'openrouter' });

    expect(result).toMatchObject({
      state: {
        providers: [{ id: 'openrouter', models: [{ id: 'visible-image' }] }],
        totalModels: 1,
      },
      success: true,
    });
  });

  it('omits unmanaged image providers from the chat tool list', async () => {
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [
          { id: 'google', name: 'Google' },
          { id: 'openrouter', name: 'OpenRouter' },
        ],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn().mockResolvedValue([{ id: 'or-image' }]),
    });

    const runtime = await imageGenerationRuntime.factory(factoryContext);
    const result = await runtime.listImageModels({});

    expect(result).toMatchObject({
      state: {
        providers: [{ id: 'openrouter', models: [{ id: 'or-image' }] }],
        totalModels: 1,
      },
      success: true,
    });
  });

  it('does not list models from a disabled provider', async () => {
    const getAiProviderModelList = vi.fn();
    callerMocks.aiModel.mockReturnValue({ getAiProviderModelList });
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [{ id: 'openrouter', name: 'OpenRouter' }],
      }),
    });

    const runtime = await imageGenerationRuntime.factory(factoryContext);

    const result = await runtime.listImageModels({ provider: 'google' });

    expect(result).toMatchObject({
      state: { providers: [], totalModels: 0 },
      success: true,
    });
    expect(getAiProviderModelList).not.toHaveBeenCalled();
  });
});
