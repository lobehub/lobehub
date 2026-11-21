import { AsyncTaskStatus } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { VideoGenerationRuntimeService } from './index';
import { VideoGenerationExecutionRuntime } from './index';

const DEFAULT_VIDEO_GENERATION_MODEL = 'video-model-1';
const DEFAULT_VIDEO_GENERATION_PROVIDER = 'provider-1';

const modelParameters = {
  duration: {
    default: 5,
    enum: [5, 10],
  },
  prompt: { default: '' },
};

const successStatus = {
  asyncTaskId: 'task-1',
  error: null,
  generation: {
    asset: {
      coverUrl: 'https://cdn.example.com/cover.webp',
      type: 'video',
      url: 'https://cdn.example.com/video.mp4',
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
  overrides: Partial<VideoGenerationRuntimeService> = {},
): VideoGenerationRuntimeService => ({
  createGenerationTopic: vi.fn().mockResolvedValue('topic-1'),
  createVideo: vi.fn().mockResolvedValue({
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
  getVideoModelLatencies: vi.fn().mockResolvedValue([
    {
      avgLatencyMs: 76_000,
      model: DEFAULT_VIDEO_GENERATION_MODEL,
      provider: DEFAULT_VIDEO_GENERATION_PROVIDER,
    },
  ]),
  listVideoModels: vi.fn().mockResolvedValue({
    providers: [
      {
        id: DEFAULT_VIDEO_GENERATION_PROVIDER,
        models: [
          {
            description: 'A cinematic text-to-video model.',
            displayName: 'Video Model 1',
            id: DEFAULT_VIDEO_GENERATION_MODEL,
            parameters: modelParameters,
            pricePerVideo: 0.42,
            pricing: {
              currency: 'USD',
              units: [
                {
                  name: 'videoGeneration',
                  rate: 0.42,
                  strategy: 'fixed',
                  unit: 'video',
                },
              ],
            },
          },
        ],
        name: 'Provider 1',
      },
    ],
    totalModels: 1,
  }),
  ...overrides,
});

describe('VideoGenerationExecutionRuntime', () => {
  it('lists available video models with descriptions and parameter hints', async () => {
    const runtime = new VideoGenerationExecutionRuntime(createService());

    const result = await runtime.listVideoModels();

    expect(result.success).toBe(true);
    expect(result.content).toContain(DEFAULT_VIDEO_GENERATION_MODEL);
    expect(result.content).toContain('Description: A cinematic text-to-video model.');
    expect(result.content).toContain('parameters: duration, prompt');
    expect(result.content).toContain('avgLatencyMs: 76000');
    expect(result.content).toContain('"exactPricePerVideoUsd":0.42');
    expect(result.content).toContain('"currency":"USD"');
    expect(result.state).toMatchObject({
      providers: [{ models: [{ avgLatencyMs: 76_000 }] }],
    });
  });

  it('returns the complete parameter schema and defaults for a selected model', async () => {
    const runtime = new VideoGenerationExecutionRuntime(createService());

    const result = await runtime.getVideoModelParameters({
      model: DEFAULT_VIDEO_GENERATION_MODEL,
      provider: DEFAULT_VIDEO_GENERATION_PROVIDER,
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      avgLatencyMs: 76_000,
      defaultValues: {
        duration: 5,
        prompt: '',
      },
      model: DEFAULT_VIDEO_GENERATION_MODEL,
      parameters: modelParameters,
      provider: DEFAULT_VIDEO_GENERATION_PROVIDER,
    });
    expect(result.content).toContain('Copy this value to generateVideo.estimatedDurationMs.');
  });

  it('selects an enabled model, creates a video topic, and returns a background task', async () => {
    const service = createService();
    const runtime = new VideoGenerationExecutionRuntime(service);

    const result = await runtime.generateVideo({
      imageUrl: ' https://cdn.example.com/start.png ',
      parameters: { duration: 5 },
      prompt: '  A paper airplane gliding over a miniature city  ',
      estimatedDurationMs: 75_700.9,
      waitUntilComplete: false,
    });

    expect(result.success).toBe(true);
    expect(service.createGenerationTopic).toHaveBeenCalledWith(
      'video',
      'A paper airplane gliding over a miniature city',
    );
    expect(service.createVideo).toHaveBeenCalledWith({
      generationTopicId: 'topic-1',
      model: DEFAULT_VIDEO_GENERATION_MODEL,
      params: {
        duration: 5,
        imageUrl: 'https://cdn.example.com/start.png',
        prompt: 'A paper airplane gliding over a miniature city',
      },
      provider: DEFAULT_VIDEO_GENERATION_PROVIDER,
    });
    expect(result.state).toMatchObject({ estimatedDurationMs: 75_700 });
    expect(result.content).toContain('Use getVideoGenerationStatus');
  });

  describe('generation parameters', () => {
    const seedanceParameters = {
      aspectRatio: { default: 'adaptive', enum: ['adaptive', '16:9', '9:16'] },
      duration: { default: 5, max: 12, min: 4 },
      generateAudio: { default: true },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p', '1080p'] },
    };

    const createSeedanceService = (parameters: unknown = seedanceParameters) =>
      createService({
        listVideoModels: vi.fn().mockResolvedValue({
          providers: [
            {
              id: 'lobehub',
              models: [{ id: 'seedance-1-5-pro-251215', parameters }],
              name: 'LobeHub',
            },
          ],
          totalModels: 1,
        }),
      });

    const generate = (service: VideoGenerationRuntimeService, args: Record<string, unknown>) =>
      new VideoGenerationExecutionRuntime(service).generateVideo({
        model: 'seedance-1-5-pro-251215',
        prompt: 'A paper airplane',
        provider: 'lobehub',
        waitUntilComplete: false,
        ...args,
      });

    const requested = {
      aspectRatio: '16:9',
      duration: 7,
      generateAudio: false,
      resolution: '1080p',
    };

    it('forwards values sent next to prompt instead of dropping them', async () => {
      const service = createSeedanceService();

      const result = await generate(service, requested);

      expect(result.success).toBe(true);
      expect(service.createVideo).toHaveBeenCalledWith(
        expect.objectContaining({ params: { ...requested, prompt: 'A paper airplane' } }),
      );
    });

    it('decodes parameters sent as a JSON string', async () => {
      const service = createSeedanceService();

      await generate(service, { parameters: JSON.stringify(requested) });

      expect(service.createVideo).toHaveBeenCalledWith(
        expect.objectContaining({ params: { ...requested, prompt: 'A paper airplane' } }),
      );
    });

    it('coerces numeric and boolean strings to the schema types', async () => {
      const service = createSeedanceService();

      await generate(service, { parameters: { duration: '6', generateAudio: 'false' } });

      expect(service.createVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { duration: 6, generateAudio: false, prompt: 'A paper airplane' },
        }),
      );
    });

    it.each([
      ['an out-of-range duration', { duration: 20 }, '`duration` must be at most 12'],
      ['a fractional duration', { duration: 7.5 }, '`duration` must move in steps of 1'],
      ['an unsupported resolution', { resolution: '4k' }, '`resolution` must be one of'],
      ['a key the model does not declare', { seed: 1 }, 'does not support `seed`'],
      ['a non-standard key', { mode: 't2v' }, 'Unsupported video parameters: `mode`'],
      ['a non-numeric duration', { duration: 'long' }, '`duration` must be a number'],
    ])('rejects %s before creating anything', async (_name, parameters, message) => {
      const service = createSeedanceService();

      const result = await generate(service, { parameters });

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ type: 'InvalidToolArguments' });
      expect(result.content).toContain(message);
      expect(service.createGenerationTopic).not.toHaveBeenCalled();
      expect(service.createVideo).not.toHaveBeenCalled();
    });

    it('treats null optional values as unset', async () => {
      const service = createSeedanceService();

      const result = await generate(service, {
        parameters: { duration: 7, mode: null, resolution: null },
      });

      expect(result.success).toBe(true);
      expect(service.createVideo).toHaveBeenCalledWith(
        expect.objectContaining({ params: { duration: 7, prompt: 'A paper airplane' } }),
      );
    });

    it('rejects a value passed twice with different values', async () => {
      const service = createSeedanceService();

      const result = await generate(service, { duration: 7, parameters: { duration: 6 } });

      expect(result.success).toBe(false);
      expect(result.content).toContain('`duration` was passed twice');
      expect(service.createVideo).not.toHaveBeenCalled();
    });

    it('rejects a non-standard key for a model without a parameter schema', async () => {
      const service = createSeedanceService(undefined);

      const result = await generate(service, { parameters: { mode: 't2v' } });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Unsupported video parameters: `mode`');
      expect(service.createVideo).not.toHaveBeenCalled();
    });

    it('returns parameters for a model card without a prompt entry', async () => {
      const parameters = { duration: { default: 5, max: 10, min: 5 } };
      const runtime = new VideoGenerationExecutionRuntime(createSeedanceService(parameters));

      const result = await runtime.getVideoModelParameters({
        model: 'seedance-1-5-pro-251215',
        provider: 'lobehub',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({ defaultValues: { duration: 5 }, parameters });
    });
  });

  it('reports a rejected pre-charge instead of a started task in no-wait mode', async () => {
    const service = createService({
      getGenerationStatus: vi.fn().mockResolvedValue({
        asyncTaskId: 'task-1',
        error: {
          body: { detail: 'Insufficient balance to start this video generation.' },
          name: 'InsufficientBalance',
        },
        generation: null,
        generationId: 'generation-1',
        status: AsyncTaskStatus.Error,
      }),
    });
    const runtime = new VideoGenerationExecutionRuntime(service);

    const result = await runtime.generateVideo({
      prompt: 'A paper airplane gliding over a miniature city',
      waitUntilComplete: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ type: 'GenerateVideoFailed' });
    expect(result.content).toContain('Insufficient balance to start this video generation.');
    expect(result.content).not.toContain('Video generation started');
    expect(service.getGenerationStatus).toHaveBeenCalledWith({
      asyncTaskId: 'task-1',
      generationId: 'generation-1',
    });
  });

  it('keeps reporting a started task when the first status read fails', async () => {
    const service = createService({
      getGenerationStatus: vi.fn().mockRejectedValue(new Error('status endpoint unavailable')),
    });
    const runtime = new VideoGenerationExecutionRuntime(service);

    const result = await runtime.generateVideo({
      prompt: 'A calm ocean aerial shot',
      waitUntilComplete: false,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Use getVideoGenerationStatus');
  });

  it('falls back to the selected model latency for estimated progress', async () => {
    const runtime = new VideoGenerationExecutionRuntime(createService());

    const result = await runtime.generateVideo({
      prompt: 'A calm ocean aerial shot',
      waitUntilComplete: false,
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ estimatedDurationMs: 76_000 });
  });

  it('waits for completion and returns the exact markdown video link', async () => {
    const runtime = new VideoGenerationExecutionRuntime(createService());

    const result = await runtime.generateVideo({
      prompt: 'A slow dolly shot through a neon greenhouse',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('[Generated video](https://cdn.example.com/video.mp4)');
    expect(result.state).toMatchObject({
      generation: {
        asset: {
          url: 'https://cdn.example.com/video.mp4',
        },
        status: AsyncTaskStatus.Success,
      },
    });
  });

  it('rejects a final frame without a first frame before resolving a model', async () => {
    const service = createService();
    const runtime = new VideoGenerationExecutionRuntime(service);

    const result = await runtime.generateVideo({
      endImageUrl: 'https://cdn.example.com/end.png',
      prompt: 'Transition between two scenes',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('InvalidToolArguments');
    expect(service.listVideoModels).not.toHaveBeenCalled();
    expect(service.createGenerationTopic).not.toHaveBeenCalled();
  });

  it('rejects an unavailable explicit provider and model before creating a topic', async () => {
    const service = createService({
      listVideoModels: vi.fn().mockResolvedValue({ providers: [], totalModels: 0 }),
    });
    const runtime = new VideoGenerationExecutionRuntime(service);

    const result = await runtime.generateVideo({
      model: 'disabled-model',
      prompt: 'A compact product animation',
      provider: 'disabled-provider',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('VideoModelNotFound');
    expect(result.content).toContain(
      'No enabled video generation model matched disabled-provider/disabled-model',
    );
    expect(service.createGenerationTopic).not.toHaveBeenCalled();
    expect(service.createVideo).not.toHaveBeenCalled();
  });

  it('surfaces terminal generation errors from the status API', async () => {
    const service = createService({
      getGenerationStatus: vi.fn().mockResolvedValue({
        asyncTaskId: 'task-1',
        error: {
          body: 'The prompt was rejected by the provider.',
          name: 'ContentPolicyViolation',
        },
        generation: null,
        generationId: 'generation-1',
        status: AsyncTaskStatus.Error,
      }),
    });
    const runtime = new VideoGenerationExecutionRuntime(service);

    const result = await runtime.getVideoGenerationStatus({
      asyncTaskId: 'task-1',
      generationId: 'generation-1',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('VideoGenerationFailed');
    expect(result.content).toContain('The prompt was rejected by the provider.');
  });
});
