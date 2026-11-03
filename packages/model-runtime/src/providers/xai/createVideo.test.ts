// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import { createXAIVideo, pollXAIVideoStatus, queryXAIVideoStatus } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('createXAIVideo', () => {
  const mockOptions: CreateVideoOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://api.x.ai/v1',
    provider: 'xai',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create video with basic prompt', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: 'xai-request-123' }),
    });

    const payload: CreateVideoPayload = {
      model: 'grok-2.1-video',
      params: {
        prompt: 'A cyberpunk city at night',
      },
    };

    const result = await createXAIVideo(payload, mockOptions);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.x.ai/v1/videos/generations',
      expect.any(Object),
    );
    expect(result).toEqual({ inferenceId: 'xai-request-123' });
  });

  it('should include imageUrl as image object', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: 'xai-image-input' }),
    });

    const payload: CreateVideoPayload = {
      model: 'grok-2.1-video',
      params: {
        prompt: 'Animate this',
        imageUrl: 'https://example.com/image.jpg',
      },
    };

    await createXAIVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.image).toEqual({ url: 'https://example.com/image.jpg' });
  });

  it('should include aspect_ratio parameter', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: 'xai-aspect' }),
    });

    const payload: CreateVideoPayload = {
      model: 'grok-2.1-video',
      params: {
        prompt: 'Test',
        aspectRatio: '21:9',
      },
    };

    await createXAIVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.aspect_ratio).toBe('21:9');
  });

  it('should include duration parameter', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: 'xai-duration' }),
    });

    const payload: CreateVideoPayload = {
      model: 'grok-2.1-video',
      params: {
        prompt: 'Test',
        duration: 6,
      },
    };

    await createXAIVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.duration).toBe(6);
  });

  it('should include resolution parameter', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: 'xai-resolution' }),
    });

    const payload: CreateVideoPayload = {
      model: 'grok-2.1-video',
      params: {
        prompt: 'Test',
        resolution: '4k',
      },
    };

    await createXAIVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.resolution).toBe('4k');
  });

  it('should include size parameter', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request_id: 'xai-size' }),
    });

    const payload: CreateVideoPayload = {
      model: 'grok-2.1-video',
      params: {
        prompt: 'Test',
        size: '1920x1080',
      },
    };

    await createXAIVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.size).toBe('1920x1080');
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Content policy violation',
    });

    const payload: CreateVideoPayload = {
      model: 'grok-2.1-video',
      params: { prompt: 'Test' },
    };

    await expect(createXAIVideo(payload, mockOptions)).rejects.toThrow(
      'XAI video API error: 403 Content policy violation',
    );
  });

  it('should throw when response missing request_id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const payload: CreateVideoPayload = {
      model: 'grok-2.1-video',
      params: { prompt: 'Test' },
    };

    await expect(createXAIVideo(payload, mockOptions)).rejects.toThrow(
      'Invalid response: missing request_id',
    );
  });
});

describe('pollXAIVideoStatus', () => {
  const options = {
    apiKey: 'test-key',
    baseURL: 'https://api.x.ai/v1',
  };

  it('should return success when status is done', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'done',
        video: { url: 'https://cdn.x.ai/video.mp4' },
      }),
    });

    const result = await pollXAIVideoStatus('request-123', options);

    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://cdn.x.ai/video.mp4',
    });
  });

  it('should return failed when status is failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'failed',
        error: { message: 'Content moderation failed' },
      }),
    });

    const result = await pollXAIVideoStatus('request-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Content moderation failed',
    });
  });

  it('should return pending when status is processing', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'processing' }),
    });

    const result = await pollXAIVideoStatus('request-123', options);

    expect(result).toEqual({ status: 'pending' });
  });

  it('should return failed when done but no video URL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'done',
        video: {},
      }),
    });

    const result = await pollXAIVideoStatus('request-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Task succeeded but no video URL found',
    });
  });
});

describe('queryXAIVideoStatus', () => {
  it('should query status endpoint', async () => {
    const mockResponse = {
      status: 'processing',
      model: 'grok-2.1-video',
      video: { duration: 6 },
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await queryXAIVideoStatus('request-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.x.ai/v1',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.x.ai/v1/videos/request-123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Request not found',
    });

    await expect(
      queryXAIVideoStatus('invalid-request', {
        apiKey: 'test-key',
        baseURL: 'https://api.x.ai/v1',
      }),
    ).rejects.toThrow('XAI status API error: 404 Request not found');
  });
});
