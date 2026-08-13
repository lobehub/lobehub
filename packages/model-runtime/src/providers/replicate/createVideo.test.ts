import type Replicate from 'replicate';
import { describe, expect, it, vi } from 'vitest';

import type { CreateVideoPayload } from '../../types';
import { createReplicateVideo, extractVideoUrl, pollReplicateVideoStatus } from './createVideo';

const buildClient = (overrides: {
  create?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
}) =>
  ({
    predictions: {
      create: overrides.create ?? vi.fn(),
      get: overrides.get ?? vi.fn(),
    },
  }) as unknown as Replicate;

const payload = (params: Partial<CreateVideoPayload['params']> = {}): CreateVideoPayload => ({
  model: 'prunaai/p-video',
  params: { prompt: 'a cat surfing', ...params },
});

describe('extractVideoUrl', () => {
  it('reads a bare URL string', () => {
    expect(extractVideoUrl('https://replicate.dev/out.mp4')).toBe('https://replicate.dev/out.mp4');
  });

  it('reads the first URL of an array', () => {
    expect(extractVideoUrl(['https://a.mp4', 'https://b.mp4'])).toBe('https://a.mp4');
  });

  it('reads a composite object keyed by media type', () => {
    expect(extractVideoUrl({ audio: 'https://a.mp3', video: 'https://v.mp4' })).toBe(
      'https://v.mp4',
    );
  });

  it('reads a nested { url } object', () => {
    expect(extractVideoUrl({ video: { url: 'https://v.mp4' } })).toBe('https://v.mp4');
  });

  it('returns undefined for empty or unusable output', () => {
    expect(extractVideoUrl('')).toBeUndefined();
    expect(extractVideoUrl([])).toBeUndefined();
    expect(extractVideoUrl(null)).toBeUndefined();
    expect(extractVideoUrl({ seed: 42 })).toBeUndefined();
  });
});

describe('createReplicateVideo', () => {
  it('submits a prediction and returns its id without waiting for the result', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pred-1', status: 'starting' });

    const result = await createReplicateVideo(buildClient({ create }), payload());

    expect(result).toEqual({ inferenceId: 'pred-1' });
    expect(create).toHaveBeenCalledWith({
      input: { disable_safety_filter: false, prompt: 'a cat surfing' },
      model: 'prunaai/p-video',
    });
  });

  it('keeps the safety filter enabled even though Replicate defaults it off', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pred-1' });

    await createReplicateVideo(buildClient({ create }), payload());

    expect(create.mock.calls[0][0].input.disable_safety_filter).toBe(false);
  });

  it('maps standard params onto Replicate input names', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pred-1' });

    await createReplicateVideo(
      buildClient({ create }),
      payload({
        aspectRatio: '9:16',
        duration: 10,
        generateAudio: false,
        resolution: '1080p',
        seed: 7,
      }),
    );

    expect(create.mock.calls[0][0].input).toEqual({
      aspect_ratio: '9:16',
      disable_safety_filter: false,
      duration: 10,
      prompt: 'a cat surfing',
      resolution: '1080p',
      save_audio: false,
      seed: 7,
    });
  });

  it('maps image inputs and drops aspect ratio for image-to-video', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pred-1' });

    await createReplicateVideo(
      buildClient({ create }),
      payload({
        aspectRatio: '16:9',
        endImageUrl: 'https://end.png',
        imageUrl: 'https://start.png',
      }),
    );

    const { input } = create.mock.calls[0][0];
    expect(input.image).toBe('https://start.png');
    expect(input.last_frame_image).toBe('https://end.png');
    expect(input).not.toHaveProperty('aspect_ratio');
  });

  it('omits empty optional params rather than sending nulls', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pred-1' });

    await createReplicateVideo(
      buildClient({ create }),
      payload({ imageUrl: null, resolution: undefined, seed: null }),
    );

    expect(create.mock.calls[0][0].input).toEqual({
      disable_safety_filter: false,
      prompt: 'a cat surfing',
    });
  });

  it('sends seed 0, which is a valid seed rather than an empty value', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pred-1' });

    await createReplicateVideo(buildClient({ create }), payload({ seed: 0 }));

    expect(create.mock.calls[0][0].input.seed).toBe(0);
  });

  it('throws when Replicate returns no prediction id', async () => {
    const create = vi.fn().mockResolvedValue({});

    await expect(createReplicateVideo(buildClient({ create }), payload())).rejects.toThrow(
      'missing prediction id',
    );
  });
});

describe('pollReplicateVideoStatus', () => {
  it('returns the video URL once the prediction succeeds', async () => {
    const get = vi.fn().mockResolvedValue({ output: 'https://v.mp4', status: 'succeeded' });

    await expect(pollReplicateVideoStatus(buildClient({ get }), 'pred-1')).resolves.toEqual({
      status: 'success',
      videoUrl: 'https://v.mp4',
    });
    expect(get).toHaveBeenCalledWith('pred-1');
  });

  it('fails when a succeeded prediction carries no URL', async () => {
    const get = vi.fn().mockResolvedValue({ output: null, status: 'succeeded' });

    await expect(pollReplicateVideoStatus(buildClient({ get }), 'pred-1')).resolves.toEqual({
      error: 'Prediction succeeded but returned no video URL',
      status: 'failed',
    });
  });

  it('surfaces the provider error message on failure', async () => {
    const get = vi.fn().mockResolvedValue({ error: 'NSFW content detected', status: 'failed' });

    await expect(pollReplicateVideoStatus(buildClient({ get }), 'pred-1')).resolves.toEqual({
      error: 'NSFW content detected',
      status: 'failed',
    });
  });

  it('reports cancellation as a failure', async () => {
    const get = vi.fn().mockResolvedValue({ status: 'canceled' });

    await expect(pollReplicateVideoStatus(buildClient({ get }), 'pred-1')).resolves.toEqual({
      error: 'Video generation was canceled',
      status: 'failed',
    });
  });

  it.each(['starting', 'processing'])('reports %s as pending', async (status) => {
    const get = vi.fn().mockResolvedValue({ status });

    await expect(pollReplicateVideoStatus(buildClient({ get }), 'pred-1')).resolves.toEqual({
      status: 'pending',
    });
  });
});
