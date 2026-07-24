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
