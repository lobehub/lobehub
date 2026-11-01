import { AsyncTaskStatus } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { ImageGenerationRuntimeService } from './index';
import { ImageGenerationExecutionRuntime } from './index';

const DEFAULT_IMAGE_GENERATION_MODEL = 'image-model-1';
const DEFAULT_IMAGE_GENERATION_PROVIDER = 'provider-1';

const modelParameters = {
  prompt: { default: '' },
  size: {
    default: '1024x1024',
    enum: ['1024x1024', '1536x1024'],
  },
};

const successStatus = {
  asyncTaskId: 'task-1',
  error: null,
  generation: {
    asset: {
      type: 'image',
      url: 'https://cdn.example.com/image.png',
    },
    asyncTaskId: 'task-1',
    createdAt: new Date(),
    id: 'generation-1',
    seed: null,
    task: {
      id: 'task-1',
      status: AsyncTaskStatus.Success,
    },
  },
  generationId: 'generation-1',
  status: AsyncTaskStatus.Success,
};

const createService = (
  overrides: Partial<ImageGenerationRuntimeService> = {},
): ImageGenerationRuntimeService => ({
  createGenerationTopic: vi.fn().mockResolvedValue('topic-1'),
  createImage: vi.fn().mockResolvedValue({
    data: {
      batch: { id: 'batch-1' },
      generations: [
        {
          asyncTaskId: 'task-1',
          id: 'generation-1',
        },
      ],
    },
    success: true,
  }),
  getGenerationStatus: vi.fn().mockResolvedValue(successStatus),
  listImageModels: vi.fn().mockResolvedValue({
    providers: [
      {
        id: DEFAULT_IMAGE_GENERATION_PROVIDER,
        models: [
          {
            description: 'A fast image generation and editing model.',
            displayName: 'GPT Image 2',
            id: DEFAULT_IMAGE_GENERATION_MODEL,
            parameters: modelParameters,
          },
        ],
        name: 'Provider 1',
      },
    ],
    totalModels: 1,
  }),
  ...overrides,
});

describe('ImageGenerationExecutionRuntime', () => {
  it('lists available image models with descriptions and parameter hints', async () => {
    const runtime = new ImageGenerationExecutionRuntime(createService());

    const result = await runtime.listImageModels();

    expect(result.success).toBe(true);
    expect(result.content).toContain(DEFAULT_IMAGE_GENERATION_MODEL);
    expect(result.content).toContain('Description: A fast image generation and editing model.');
    expect(result.content).toContain('parameters: prompt, size');
    expect(result.state).toMatchObject({
      providers: [
        {
          models: [
            {
              description: 'A fast image generation and editing model.',
            },
          ],
        },
      ],
    });
  });

  it('returns model parameter defaults for a provider/model pair', async () => {
    const runtime = new ImageGenerationExecutionRuntime(createService());

    const result = await runtime.getImageModelParameters({
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      provider: DEFAULT_IMAGE_GENERATION_PROVIDER,
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      defaultValues: {
        prompt: '',
        size: '1024x1024',
      },
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      provider: DEFAULT_IMAGE_GENERATION_PROVIDER,
    });
    expect(result.content).toContain('Complete parameter schema');
    expect(result.content).toContain('"enum": [');
    expect(result.content).toContain('"1536x1024"');
  });

  it('selects the first enabled image model when provider and model are omitted', async () => {
    const service = createService();
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({ prompt: 'A compact workbench UI' });

    expect(result.success).toBe(true);
    expect(service.listImageModels).toHaveBeenCalledWith({
      limit: 200,
      provider: undefined,
    });
    expect(service.createGenerationTopic).toHaveBeenCalledWith('image', 'A compact workbench UI');
    expect(service.createImage).toHaveBeenCalledWith({
      generationTopicId: 'topic-1',
      imageNum: 1,
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      params: {
        prompt: 'A compact workbench UI',
      },
      provider: DEFAULT_IMAGE_GENERATION_PROVIDER,
    });
    expect(service.getGenerationStatus).toHaveBeenCalledWith({
      asyncTaskId: 'task-1',
      generationId: 'generation-1',
    });
    expect(result.state).toMatchObject({
      batchId: 'batch-1',
      generations: [
        {
          asset: {
            url: 'https://cdn.example.com/image.png',
          },
          asyncTaskId: 'task-1',
          generationId: 'generation-1',
          status: AsyncTaskStatus.Success,
        },
      ],
    });
    expect(result.content).toContain('https://cdn.example.com/image.png');
    expect(result.content).not.toContain('imageUrl=https://cdn.example.com/image.png');
    expect(result.content).toContain('Copy them exactly');
    expect(result.content).toContain('![Generated image 1](https://cdn.example.com/image.png)');
  });

  it('selects the first enabled model from an explicitly requested provider', async () => {
    const service = createService();
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({
      prompt: 'A compact workbench UI',
      provider: DEFAULT_IMAGE_GENERATION_PROVIDER,
    });

    expect(result.success).toBe(true);
    expect(service.listImageModels).toHaveBeenCalledWith({
      limit: 200,
      provider: DEFAULT_IMAGE_GENERATION_PROVIDER,
    });
    expect(service.createImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_IMAGE_GENERATION_MODEL,
        provider: DEFAULT_IMAGE_GENERATION_PROVIDER,
      }),
    );
  });

  it('resolves the provider for an explicitly requested model', async () => {
    const service = createService({
      listImageModels: vi.fn().mockResolvedValue({
        providers: [
          {
            id: 'provider-2',
            models: [{ id: 'requested-model' }],
          },
        ],
        totalModels: 1,
      }),
    });
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({
      model: 'requested-model',
      prompt: 'A compact workbench UI',
    });

    expect(result.success).toBe(true);
    expect(service.createImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'requested-model',
        provider: 'provider-2',
      }),
    );
  });

  it('rejects an unavailable explicit provider and model before creating a topic', async () => {
    const service = createService({
      listImageModels: vi.fn().mockResolvedValue({ providers: [], totalModels: 0 }),
    });
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({
      model: 'disabled-model',
      prompt: 'A compact workbench UI',
      provider: 'disabled-provider',
    });

    expect(service.listImageModels).toHaveBeenCalledWith({
      limit: 200,
      provider: 'disabled-provider',
    });
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ImageModelNotFound');
    expect(result.content).toContain(
      'No enabled image generation model matched disabled-provider/disabled-model',
    );
    expect(service.createGenerationTopic).not.toHaveBeenCalled();
    expect(service.createImage).not.toHaveBeenCalled();
  });

  it('fails before creating a topic when no enabled image model is available', async () => {
    const service = createService({
      listImageModels: vi.fn().mockResolvedValue({ providers: [], totalModels: 0 }),
    });
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({ prompt: 'A compact workbench UI' });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ImageModelNotFound');
    expect(result.content).toContain('No enabled image generation model is available');
    expect(service.createGenerationTopic).not.toHaveBeenCalled();
  });

  it('can return task ids immediately when waiting is disabled', async () => {
    const service = createService();
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({
      prompt: 'A compact workbench UI',
      waitUntilComplete: false,
    });

    expect(result.success).toBe(true);
    expect(service.getGenerationStatus).not.toHaveBeenCalled();
    expect(result.content).toContain('Use getImageGenerationStatus');
    expect(result.state).toMatchObject({
      generations: [{ asyncTaskId: 'task-1', generationId: 'generation-1' }],
      waitUntilComplete: false,
    });
  });

  it('returns processing state when blocking wait times out', async () => {
    vi.useFakeTimers();
    try {
      const service = createService({
        getGenerationStatus: vi.fn().mockResolvedValue({
          asyncTaskId: 'task-1',
          error: null,
          generation: null,
          generationId: 'generation-1',
          status: AsyncTaskStatus.Processing,
        }),
      });
      const runtime = new ImageGenerationExecutionRuntime(service);

      const promise = runtime.generateImage({
        prompt: 'A compact workbench UI',
        waitTimeoutMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.content).toContain('still processing');
      expect(result.state).toMatchObject({
        generations: [
          {
            asyncTaskId: 'task-1',
            generationId: 'generation-1',
            status: AsyncTaskStatus.Processing,
          },
        ],
        waitTimedOut: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps generated task ids when waiting for status fails after task creation', async () => {
    const service = createService({
      getGenerationStatus: vi.fn().mockRejectedValue(new Error('network timeout')),
    });
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({ prompt: 'A compact workbench UI' });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(service.createImage).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('latest status could not be checked');
    expect(result.content).toContain('Use getImageGenerationStatus later');
    expect(result.state).toMatchObject({
      batchId: 'batch-1',
      generations: [{ asyncTaskId: 'task-1', generationId: 'generation-1' }],
      generationTopicId: 'topic-1',
      waitError: 'network timeout',
    });
  });

  it('propagates cancellation while polling instead of returning a successful tool result', async () => {
    const abortController = new AbortController();
    const service = createService({
      getGenerationStatus: vi.fn().mockImplementation(async () => {
        abortController.abort();
        return {
          asyncTaskId: 'task-1',
          error: null,
          generation: null,
          generationId: 'generation-1',
          status: AsyncTaskStatus.Processing,
        };
      }),
    });
    const runtime = new ImageGenerationExecutionRuntime(service);

    await expect(
      runtime.generateImage(
        { prompt: 'A compact workbench UI' },
        { signal: abortController.signal },
      ),
    ).rejects.toThrow('Image generation wait was aborted');
  });

  it('returns the persisted async-task error after a generation is rejected', async () => {
    const service = createService({
      getGenerationStatus: vi.fn().mockResolvedValue({
        asyncTaskId: 'task-1',
        error: {
          body: { detail: 'Insufficient budget to perform this operation' },
          name: 'SubscriptionPlanLimit',
        },
        generation: null,
        generationId: 'generation-1',
        status: AsyncTaskStatus.Error,
      }),
    });
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({ prompt: 'A compact workbench UI' });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ImageGenerationFailed');
    expect(result.content).toContain('finished with errors');
    expect(result.content).toContain('Insufficient budget to perform this operation');
  });

  it('rejects invalid image counts before creating tasks', async () => {
    const service = createService();
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({ imageNum: 9, prompt: 'A poster' });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('InvalidToolArguments');
    expect(service.createGenerationTopic).not.toHaveBeenCalled();
  });

  it('rejects createImage responses without generation task identifiers', async () => {
    const service = createService({
      createImage: vi.fn().mockResolvedValue({
        data: {
          batch: {},
          generations: [{ asyncTaskId: null }],
        },
        success: true,
      }),
    });
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({ prompt: 'A compact workbench UI' });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('GenerateImageFailed');
    expect(result.content).toContain('generation or async task ids');
    expect(service.getGenerationStatus).not.toHaveBeenCalled();
  });

  it('returns image URL when status succeeds', async () => {
    const runtime = new ImageGenerationExecutionRuntime(
      createService({
        getGenerationStatus: vi.fn().mockResolvedValue(successStatus),
      }),
    );

    const result = await runtime.getImageGenerationStatus({
      asyncTaskId: 'task-1',
      generationId: 'generation-1',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('https://cdn.example.com/image.png');
  });
});
