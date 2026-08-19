// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import { createOpenRouterVideo, pollOpenRouterVideoStatus } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const mockOptions: CreateVideoOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://openrouter.ai/api/v1',
  provider: 'openrouter',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createOpenRouterVideo', () => {
  it('submits duration, aspect_ratio, and input_references', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ id: 'video-job-1' }),
      ok: true,
    });

    const payload: CreateVideoPayload = {
      model: 'google/veo-3',
      params: {
        aspectRatio: '9:16',
        duration: 5.4,
        imageUrl: 'https://cdn.example/ref.png',
        prompt: 'A cat walking',
        resolution: '1080p',
      },
    };

    const result = await createOpenRouterVideo(payload, mockOptions);

    expect(result).toEqual({ inferenceId: 'video-job-1' });
    expect(fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/videos',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({
      aspect_ratio: '9:16',
      duration: 5,
      generate_audio: false,
      input_references: ['https://cdn.example/ref.png'],
      model: 'google/veo-3',
      prompt: 'A cat walking',
      resolution: '1080p',
    });
  });

  it('throws a generic error when the API rejects the request', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => 'OpenRouter payment required',
    });

    await expect(
      createOpenRouterVideo({ model: 'google/veo-3', params: { prompt: 'x' } }, mockOptions),
    ).rejects.toThrow('Video generation failed (402)');
  });
});

describe('pollOpenRouterVideoStatus', () => {
  it('returns the OpenRouter content proxy URL when completed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({
        status: 'completed',
        unsigned_urls: ['https://storage.example.com/out.mp4'],
      }),
      ok: true,
    });

    await expect(
      pollOpenRouterVideoStatus('video-job-1', {
        apiKey: 'test-api-key',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    ).resolves.toMatchObject({
      headers: { Authorization: 'Bearer test-api-key' },
      status: 'success',
      videoUrl: 'https://openrouter.ai/api/v1/videos/video-job-1/content',
    });
  });

  it('attaches provider-reported usage.cost as modelUsage', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({
        status: 'completed',
        usage: { cost: 0.42 },
      }),
      ok: true,
    });

    await expect(
      pollOpenRouterVideoStatus('video-job-1', { apiKey: 'test-api-key' }),
    ).resolves.toMatchObject({
      modelUsage: { cost: 0.42 },
      status: 'success',
    });
  });

  it('returns pending while the job is still running', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ status: 'processing' }),
      ok: true,
    });

    await expect(
      pollOpenRouterVideoStatus('video-job-1', { apiKey: 'test-api-key' }),
    ).resolves.toEqual({ status: 'pending' });
  });

  it('returns failed for cancelled jobs', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ error: 'safety filter', status: 'failed' }),
      ok: true,
    });

    await expect(
      pollOpenRouterVideoStatus('video-job-1', { apiKey: 'test-api-key' }),
    ).resolves.toEqual({ error: 'safety filter', status: 'failed' });
  });
});
