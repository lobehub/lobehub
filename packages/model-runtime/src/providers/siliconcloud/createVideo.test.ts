// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import {
  createSiliconCloudVideo,
  pollSiliconCloudVideoStatus,
  querySiliconCloudVideoStatus,
} from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('createSiliconCloudVideo', () => {
  const mockOptions: CreateVideoOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://api.siliconflow.cn/v1',
    provider: 'siliconcloud',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create video with basic prompt', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requestId: 'sc-request-123' }),
    });

    const payload: CreateVideoPayload = {
      model: 'stabilityai/stable-video-diffusion',
      params: {
        prompt: 'A futuristic city',
      },
    };

    const result = await createSiliconCloudVideo(payload, mockOptions);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/video/submit',
      expect.any(Object),
    );
    expect(result).toEqual({ inferenceId: 'sc-request-123' });
  });

  it('should include image_size parameter', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requestId: 'sc-size-test' }),
    });

    const payload: CreateVideoPayload = {
      model: 'stabilityai/stable-video-diffusion',
      params: {
        prompt: 'Test',
        size: '1920x1080',
      },
    };

    await createSiliconCloudVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.image_size).toBe('1920x1080');
  });

  it('should include seed parameter', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requestId: 'sc-seed-test' }),
    });

    const payload: CreateVideoPayload = {
      model: 'stabilityai/stable-video-diffusion',
      params: {
        prompt: 'Test',
        seed: 42,
      },
    };

    await createSiliconCloudVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.seed).toBe(42);
  });

  it('should not include seed when null', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requestId: 'sc-null-seed' }),
    });

    const payload: CreateVideoPayload = {
      model: 'stabilityai/stable-video-diffusion',
      params: {
        prompt: 'Test',
        seed: null,
      },
    };

    await createSiliconCloudVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.seed).toBeUndefined();
  });

  it('should include imageUrl as image parameter', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ requestId: 'sc-image-test' }),
    });

    const payload: CreateVideoPayload = {
      model: 'stabilityai/stable-video-diffusion',
      params: {
        prompt: 'Animate this',
        imageUrl: 'https://example.com/image.jpg',
      },
    };

    await createSiliconCloudVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.image).toBe('https://example.com/image.jpg');
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => 'Insufficient balance',
    });

    const payload: CreateVideoPayload = {
      model: 'stabilityai/stable-video-diffusion',
      params: { prompt: 'Test' },
    };

    await expect(createSiliconCloudVideo(payload, mockOptions)).rejects.toThrow(
      'SiliconCloud video API error: 402 Insufficient balance',
    );
  });

  it('should throw when response missing requestId', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const payload: CreateVideoPayload = {
      model: 'stabilityai/stable-video-diffusion',
      params: { prompt: 'Test' },
    };

    await expect(createSiliconCloudVideo(payload, mockOptions)).rejects.toThrow(
      'Invalid response: missing requestId',
    );
  });
});

describe('pollSiliconCloudVideoStatus', () => {
  const options = {
    apiKey: 'test-key',
    baseURL: 'https://api.siliconflow.cn/v1',
  };

  it('should return success when status is Succeed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'Succeed',
        results: {
          videos: [{ url: 'https://cdn.siliconcloud.cn/video.mp4' }],
        },
      }),
    });

    const result = await pollSiliconCloudVideoStatus('request-123', options);

    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://cdn.siliconcloud.cn/video.mp4',
    });
  });

  it('should return failed when status is Failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'Failed',
        reason: 'Content moderation failed',
      }),
    });

    const result = await pollSiliconCloudVideoStatus('request-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Content moderation failed',
    });
  });

  it('should return pending when status is Processing', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'Processing' }),
    });

    const result = await pollSiliconCloudVideoStatus('request-123', options);

    expect(result).toEqual({ status: 'pending' });
  });

  it('should return failed when succeeded but no video URL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'Succeed',
        results: { videos: [] },
      }),
    });

    const result = await pollSiliconCloudVideoStatus('request-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Task succeeded but no video URL found',
    });
  });
});

describe('querySiliconCloudVideoStatus', () => {
  it('should query status with POST request', async () => {
    const mockResponse = {
      status: 'Processing',
      requestId: 'request-123',
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await querySiliconCloudVideoStatus('request-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.siliconflow.cn/v1',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/video/status',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ requestId: 'request-123' }),
        headers: {
          'Authorization': 'Bearer test-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(result).toEqual(mockResponse);
  });
});
