import { beforeEach, describe, expect, it, vi } from 'vitest';

import { videoGenerationRuntime } from '../videoGeneration';

const callerMocks = vi.hoisted(() => ({
  aiModel: vi.fn(() => ({})),
  aiProvider: vi.fn(() => ({})),
  generation: vi.fn(() => ({})),
  generationTopic: vi.fn(() => ({})),
  video: vi.fn(() => ({})),
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
vi.mock('@/server/routers/lambda/video', () => ({
  videoRouter: { createCaller: callerMocks.video },
}));

describe('videoGenerationRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callerMocks.aiModel.mockReturnValue({});
    callerMocks.aiProvider.mockReturnValue({});
    callerMocks.generation.mockReturnValue({});
    callerMocks.generationTopic.mockReturnValue({});
    callerMocks.video.mockReturnValue({});
  });

  it('passes the request and workspace scope to every router caller', () => {
    videoGenerationRuntime.factory({
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
    expect(callerMocks.video).toHaveBeenCalledWith(callerContext);
  });

  it('preserves public agent visibility for generated video topics', async () => {
    const createTopic = vi.fn().mockResolvedValue('topic-1');
    callerMocks.generationTopic.mockReturnValue({ createTopic });
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledVideoAiProviders: [{ id: 'provider-1', name: 'Provider 1' }],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn().mockResolvedValue([{ id: 'video-model-1' }]),
    });
    callerMocks.video.mockReturnValue({
      createVideo: vi.fn().mockResolvedValue({
        data: {
          batch: { id: 'batch-1' },
          generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }],
        },
        success: true,
      }),
    });

    const runtime = videoGenerationRuntime.factory({
      agentVisibility: 'public',
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await runtime.generateVideo({
      prompt: 'A shared workspace product animation',
      waitUntilComplete: false,
    });

    expect(result.success).toBe(true);
    expect(createTopic).toHaveBeenCalledWith({
      title: 'A shared workspace product animation',
      type: 'video',
      visibility: 'public',
    });
  });

  it('preserves model descriptions and complete parameter schemas', async () => {
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledVideoAiProviders: [{ id: 'provider-1', name: 'Provider 1' }],
      }),
    });
    callerMocks.aiModel.mockReturnValue({
      getAiProviderModelList: vi.fn().mockResolvedValue([
        {
          description: 'A cinematic text-to-video model.',
          displayName: 'Video Model 1',
          enabled: true,
          id: 'video-model-1',
          parameters: {
            duration: {
              default: 5,
              enum: [5, 10],
            },
            prompt: { default: '' },
          },
          type: 'video',
        },
      ]),
    });

    const runtime = videoGenerationRuntime.factory({
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await runtime.listVideoModels({ provider: 'provider-1' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Description: A cinematic text-to-video model.');
    expect(result.state).toMatchObject({
      providers: [
        {
          models: [
            {
              description: 'A cinematic text-to-video model.',
              parameters: {
                duration: {
                  enum: [5, 10],
                },
              },
            },
          ],
        },
      ],
    });
  });

  it('does not list models from a disabled provider', async () => {
    const getAiProviderModelList = vi.fn();
    callerMocks.aiModel.mockReturnValue({ getAiProviderModelList });
    callerMocks.aiProvider.mockReturnValue({
      getAiProviderRuntimeState: vi.fn().mockResolvedValue({
        enabledVideoAiProviders: [{ id: 'provider-1', name: 'Provider 1' }],
      }),
    });

    const runtime = videoGenerationRuntime.factory({
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await runtime.listVideoModels({ provider: 'provider-2' });

    expect(result).toMatchObject({
      state: { providers: [], totalModels: 0 },
      success: true,
    });
    expect(getAiProviderModelList).not.toHaveBeenCalled();
  });
});
