import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOwnerPrincipal, resolveRunPrincipal } from '@/server/services/executionPrincipal';

import { imageGenerationRuntime } from '../imageGeneration';

const callerMocks = vi.hoisted(() => ({
  aiModel: vi.fn(() => ({})),
  aiProvider: vi.fn(() => ({})),
  generation: vi.fn(() => ({})),
  generationTopic: vi.fn(() => ({})),
  image: vi.fn(() => ({})),
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
      principal: createOwnerPrincipal('user-1'),
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

  // Regression: `callerContext` used to be built as `{clientIp, userId,
  // workspaceId}` only, silently dropping `context.agentShare` — so a share
  // visitor's image generation would reach `imageRouter.createImage` with no
  // billing marker at all and fall through to the creator's ordinary
  // billing. `imageCaller` is the only caller that reads it, but the marker
  // is forwarded on the shared `callerContext` object passed to every
  // caller (see `AuthContext.agentShare`'s JSDoc).
  it('forwards the agentShare billing marker to every router caller', () => {
    imageGenerationRuntime.factory({
      clientIp: '203.0.113.7',
      principal: resolveRunPrincipal({
        agentShare: {
          agentId: 'agent-1',
          allowReadMemory: false,
          enabledToolIds: ['lobe-image-generation'],
          shareId: 'share-1',
          visitorUserId: 'visitor-1',
        },
        userId: 'creator-1',
      }),
      toolManifestMap: {},
      workspaceId: 'workspace-1',
    });

    const expectedCallerContext = {
      agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
      clientIp: '203.0.113.7',
      userId: 'creator-1',
      workspaceId: 'workspace-1',
    };
    expect(callerMocks.image).toHaveBeenCalledWith(expectedCallerContext);
    expect(callerMocks.aiModel).toHaveBeenCalledWith(expectedCallerContext);
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
      principal: createOwnerPrincipal('user-1'),
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

  // Regression for the agent-share visitor→creator-data leak: `createImage`
  // and `getGenerationStatus` both forward the operation's own `topicId` to
  // the tRPC layer, which uses it to fail closed on a `generationId`/
  // `asyncTaskId` pair from a different chat topic (see
  // `apps/server/src/routers/lambda/generation.ts`'s `topicId` JSDoc). This
  // only tests the forwarding — the actual scoping check is asserted in
  // `generation.test.ts`.
  it('forwards the run topicId to createImage and getGenerationStatus', async () => {
    const createTopic = vi.fn().mockResolvedValue('topic-1');
    const createImage = vi.fn().mockResolvedValue({
      data: {
        batch: { id: 'batch-1' },
        generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }],
      },
      success: true,
    });
    const getGenerationStatus = vi.fn().mockResolvedValue({
      error: null,
      generation: null,
      status: 'pending',
    });
    callerMocks.generationTopic.mockReturnValue({ createTopic });
    callerMocks.image.mockReturnValue({ createImage });
    callerMocks.generation.mockReturnValue({ getGenerationStatus });
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledImageAiProviders: [{ id: 'provider-1', name: 'Provider 1' }],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn().mockResolvedValue([{ id: 'image-model-1' }]),
    });

    const runtime = imageGenerationRuntime.factory({
      toolManifestMap: {},
      topicId: 'topic-own',
      principal: createOwnerPrincipal('user-1'),
      workspaceId: 'workspace-1',
    });

    await runtime.generateImage({
      prompt: 'A shared workspace illustration',
      waitUntilComplete: false,
    });

    expect(createImage).toHaveBeenCalledWith(expect.objectContaining({ topicId: 'topic-own' }));

    await runtime.getImageGenerationStatus({
      asyncTaskId: 'task-1',
      generationId: 'generation-1',
    });

    expect(getGenerationStatus).toHaveBeenCalledWith({
      asyncTaskId: 'task-1',
      generationId: 'generation-1',
      topicId: 'topic-own',
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
      principal: createOwnerPrincipal('user-1'),
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
      principal: createOwnerPrincipal('user-1'),
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
      principal: createOwnerPrincipal('user-1'),
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
