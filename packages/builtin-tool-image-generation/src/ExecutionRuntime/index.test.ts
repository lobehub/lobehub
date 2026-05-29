import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { AsyncTaskStatus } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { ImageGenerationRuntimeService } from './index';
import { DEFAULT_IMAGE_GENERATION_MODEL, ImageGenerationExecutionRuntime } from './index';

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
        id: BRANDING_PROVIDER,
        models: [
          {
            displayName: 'GPT Image 2',
            id: DEFAULT_IMAGE_GENERATION_MODEL,
            parameters: modelParameters,
          },
        ],
        name: 'LobeHub',
      },
    ],
    totalModels: 1,
  }),
  ...overrides,
});

describe('ImageGenerationExecutionRuntime', () => {
  it('lists available image models with parameter hints', async () => {
    const runtime = new ImageGenerationExecutionRuntime(createService());

    const result = await runtime.listImageModels();

    expect(result.success).toBe(true);
    expect(result.content).toContain(DEFAULT_IMAGE_GENERATION_MODEL);
    expect(result.content).toContain('parameters: prompt, size');
  });

  it('returns model parameter defaults for a provider/model pair', async () => {
    const runtime = new ImageGenerationExecutionRuntime(createService());

    const result = await runtime.getImageModelParameters({
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      provider: BRANDING_PROVIDER,
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      defaultValues: {
        prompt: '',
        size: '1024x1024',
      },
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      provider: BRANDING_PROVIDER,
    });
  });

  it('generates an image with the default provider and model and waits for the URL', async () => {
    const service = createService();
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({ prompt: 'A compact workbench UI' });

    expect(result.success).toBe(true);
    expect(service.createGenerationTopic).toHaveBeenCalledWith('image');
    expect(service.createImage).toHaveBeenCalledWith({
      generationTopicId: 'topic-1',
      imageNum: 1,
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      params: {
        prompt: 'A compact workbench UI',
      },
      provider: BRANDING_PROVIDER,
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
    expect(result.content).toContain('![Generated image 1](https://cdn.example.com/image.png)');
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

  it('rejects invalid image counts before creating tasks', async () => {
    const service = createService();
    const runtime = new ImageGenerationExecutionRuntime(service);

    const result = await runtime.generateImage({ imageNum: 9, prompt: 'A poster' });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('InvalidToolArguments');
    expect(service.createGenerationTopic).not.toHaveBeenCalled();
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
