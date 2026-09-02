import { beforeEach, describe, expect, it, vi } from 'vitest';

import { imageGenerationRuntime } from '../imageGeneration';

// Narrow shape of the `callerContext` the runtime passes to every
// `*Router.createCaller`, just enough to type-check the spend-attribution
// assertions below without pulling in the full tRPC caller context type.
interface ImageCallerContext {
  spendOrigin?: {
    agentShare: { agentId: string; shareId: string; visitorUserId: string };
    trigger: string;
  };
}

const callerMocks = vi.hoisted(() => ({
  aiModel: vi.fn(() => ({})),
  aiProvider: vi.fn(() => ({})),
  generation: vi.fn(() => ({})),
  generationTopic: vi.fn(() => ({})),
  image: vi.fn((_ctx: ImageCallerContext) => ({})),
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

describe('imageGenerationRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callerMocks.aiModel.mockReturnValue({});
    callerMocks.aiProvider.mockReturnValue({});
    callerMocks.generation.mockReturnValue({});
    callerMocks.generationTopic.mockReturnValue({});
    callerMocks.image.mockReturnValue({});
  });

  it('passes the request and workspace scope to every router caller', () => {
    imageGenerationRuntime.factory({
      clientIp: '203.0.113.7',
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

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

  it('projects share attribution onto the image caller so visitor spend stays attributed', () => {
    imageGenerationRuntime.factory({
      agentShareVisitor: {
        agentId: 'agent-1',
        allowReadMemory: true,
        toolGrants: [{ identifier: 'lobe-image-generation' }],
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      },
      toolManifestMap: {},
      userId: 'creator-1',
    });

    const [callerContext] = callerMocks.image.mock.calls.at(-1)!;
    expect(callerContext.spendOrigin).toEqual({
      agentShare: { agentId: 'agent-1', shareId: 'share-1', visitorUserId: 'visitor-1' },
      trigger: 'agent_share',
    });
    // Permission fields of the runtime object must never leak into billing metadata.
    expect(callerContext.spendOrigin!.agentShare).not.toHaveProperty('allowReadMemory');
    expect(callerContext.spendOrigin!.agentShare).not.toHaveProperty('toolGrants');
  });

  it('omits spend attribution for a non-share run', () => {
    imageGenerationRuntime.factory({ toolManifestMap: {}, userId: 'user-1' });

    const [callerContext] = callerMocks.image.mock.calls.at(-1)!;
    expect(callerContext.spendOrigin).toBeUndefined();
  });

  it('preserves public agent visibility for generated image topics', async () => {
    const createTopic = vi.fn().mockResolvedValue('topic-1');
    callerMocks.generationTopic.mockReturnValue({ createTopic });
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [{ id: 'provider-1', name: 'Provider 1' }],
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

    const runtime = imageGenerationRuntime.factory({
      agentVisibility: 'public',
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
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

  it('preserves model descriptions and complete parameter schemas', async () => {
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [{ id: 'provider-1', name: 'Provider 1' }],
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

    const runtime = imageGenerationRuntime.factory({
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await runtime.listImageModels({ provider: 'provider-1' });

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
        enabledImageAiProviders: [{ id: 'lobehub', name: 'LobeHub' }],
        hiddenBuiltinModels: [{ id: 'hidden-image', providerId: 'lobehub' }],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn(async ({ limit }: { limit?: number }) => {
        const models = [{ id: 'hidden-image' }, { id: 'visible-image' }];
        return typeof limit === 'number' ? models.slice(0, limit) : models;
      }),
    });

    const runtime = imageGenerationRuntime.factory({
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await runtime.listImageModels({ limit: 1, provider: 'lobehub' });

    expect(result).toMatchObject({
      state: {
        providers: [{ id: 'lobehub', models: [{ id: 'visible-image' }] }],
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
        enabledImageAiProviders: [{ id: 'provider-1', name: 'Provider 1' }],
      }),
    });

    const runtime = imageGenerationRuntime.factory({
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await runtime.listImageModels({ provider: 'provider-2' });

    expect(result).toMatchObject({
      state: { providers: [], totalModels: 0 },
      success: true,
    });
    expect(getAiProviderModelList).not.toHaveBeenCalled();
  });
});
