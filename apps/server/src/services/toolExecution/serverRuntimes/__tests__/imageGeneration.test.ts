import { describe, expect, it, vi } from 'vitest';

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
  it('passes the workspace scope to every router caller', () => {
    imageGenerationRuntime.factory({
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const callerContext = { userId: 'user-1', workspaceId: 'workspace-1' };
    expect(callerMocks.aiModel).toHaveBeenCalledWith(callerContext);
    expect(callerMocks.aiProvider).toHaveBeenCalledWith(callerContext);
    expect(callerMocks.generation).toHaveBeenCalledWith(callerContext);
    expect(callerMocks.generationTopic).toHaveBeenCalledWith(callerContext);
    expect(callerMocks.image).toHaveBeenCalledWith(callerContext);
  });

  it('preserves model descriptions and complete parameter schemas', async () => {
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
});
