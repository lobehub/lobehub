// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import { createZhipuVideo, pollZhipuVideoStatus, queryZhipuVideoStatus } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('createZhipuVideo', () => {
  const mockOptions: CreateVideoOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    provider: 'zhipu',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create video with basic prompt', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'zhipu-task-123' }),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: {
        prompt: 'A robot dancing',
      },
    };

    const result = await createZhipuVideo(payload, mockOptions);

    expect(fetch).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/videos/generations',
      expect.any(Object),
    );
    expect(result).toEqual({ inferenceId: 'zhipu-task-123' });
  });

  it('should include image_url array with first frame', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-img2vid' }),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: {
        prompt: 'Animate this image',
        imageUrl: 'https://example.com/first.jpg',
      },
    };

    await createZhipuVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.image_url).toEqual(['https://example.com/first.jpg']);
  });

  it('should include both first and last frame in image_url array', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-transformer' }),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: {
        prompt: 'Transform first to last',
        imageUrl: 'https://example.com/first.jpg',
        endImageUrl: 'https://example.com/last.jpg',
      },
    };

    await createZhipuVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.image_url).toEqual([
      'https://example.com/first.jpg',
      'https://example.com/last.jpg',
    ]);
  });

  it('should include optional parameters', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-full' }),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: {
        prompt: 'Full options test',
        aspectRatio: '16:9',
        duration: 10,
        generateAudio: true,
        size: '1080p',
      },
    };

    await createZhipuVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.aspect_ratio).toBe('16:9');
    expect(body.duration).toBe(10);
    expect(body.with_audio).toBe(true);
    expect(body.size).toBe('1080p');
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => 'Insufficient credits',
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: { prompt: 'Test' },
    };

    await expect(createZhipuVideo(payload, mockOptions)).rejects.toThrow(
      'Zhipu video API error: 402 Insufficient credits',
    );
  });

  it('should throw when response missing id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: { prompt: 'Test' },
    };

    await expect(createZhipuVideo(payload, mockOptions)).rejects.toThrow(
      'Invalid response: missing task id',
    );
  });
});

describe('pollZhipuVideoStatus', () => {
  const options = {
    apiKey: 'test-key',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  };

  it('should return success when task succeeded', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_status: 'SUCCESS',
        video_result: [{ url: 'https://cdn.zhipu.ai/video.mp4' }],
      }),
    });

    const result = await pollZhipuVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://cdn.zhipu.ai/video.mp4',
    });
  });

  it('should return failed when task failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_status: 'FAIL',
        error: { message: 'Content moderation failed' },
      }),
    });

    const result = await pollZhipuVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Content moderation failed',
    });
  });

  it('should return pending when task in progress', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_status: 'RUNNING' }),
    });

    const result = await pollZhipuVideoStatus('task-123', options);

    expect(result).toEqual({ status: 'pending' });
  });

  it('should return failed when succeeded but no video URL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_status: 'SUCCESS', video_result: [] }),
    });

    const result = await pollZhipuVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Task succeeded but no video URL found',
    });
  });
});

describe('queryZhipuVideoStatus', () => {
  it('should query status endpoint correctly', async () => {
    const mockResponse = {
      task_status: 'SUCCESS',
      id: 'task-123',
      request_id: 'req-456',
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await queryZhipuVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/async-result/task-123',
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
});
