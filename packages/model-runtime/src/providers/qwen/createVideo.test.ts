// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import { createQwenVideo, pollQwenVideoStatus, queryQwenVideoStatus } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('createQwenVideo', () => {
  const mockOptions: CreateVideoOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://dashscope.aliyuncs.com',
    provider: 'qwen',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create text-to-video task', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: { task_id: 'qwen-task-123', task_status: 'PENDING' },
        request_id: 'req-456',
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'wan2.2-t2v-plus',
      params: {
        prompt: 'A beautiful sunset',
      },
    };

    const result = await createQwenVideo(payload, mockOptions);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/services/aigc/video-generation/video-synthesis'),
      expect.any(Object),
    );
    expect(result).toEqual({ inferenceId: 'qwen-task-123' });
  });

  it('should create image-to-video task for i2v models', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: { task_id: 'i2v-task-789', task_status: 'PENDING' },
        request_id: 'req-000',
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'wan2.2-i2v-plus',
      params: {
        prompt: 'Animate this image',
        imageUrl: 'https://example.com/image.jpg',
      },
    };

    await createQwenVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.input.img_url).toBe('https://example.com/image.jpg');
    expect(body.input.prompt).toBe('Animate this image');
  });

  it('should create keyframe-to-video task for kf2v models', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: { task_id: 'kf2v-task-111', task_status: 'PENDING' },
        request_id: 'req-222',
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'wan2.2-kf2v-flash',
      params: {
        prompt: 'Transform between frames',
        imageUrl: 'https://example.com/first.jpg',
        endImageUrl: 'https://example.com/last.jpg',
      },
    };

    await createQwenVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.input.first_frame_url).toBe('https://example.com/first.jpg');
    expect(body.input.last_frame_url).toBe('https://example.com/last.jpg');
    expect(body.input.prompt).toBe('Transform between frames');
  });

  it('should create vidu task with images in input.media', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: { task_id: 'vidu-task-321', task_status: 'PENDING' },
        request_id: 'req-654',
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'vidu/viduq3-turbo_start-end2video',
      params: {
        duration: 5,
        imageUrl: 'https://example.com/first.jpg',
        endImageUrl: 'https://example.com/last.jpg',
        prompt: 'A cat jumps from the windowsill to the sofa',
        resolution: '720p',
      },
    };

    await createQwenVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.input.media).toEqual([
      { type: 'image', url: 'https://example.com/first.jpg' },
      { type: 'image', url: 'https://example.com/last.jpg' },
    ]);
    expect(body.input.prompt).toBe('A cat jumps from the windowsill to the sofa');
    expect(body.parameters.duration).toBe(5);
    expect(body.parameters.resolution).toBe('720p');
  });

  it('should include optional parameters', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: { task_id: 'full-params-task', task_status: 'PENDING' },
        request_id: 'req-333',
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'wan2.2-t2v-plus',
      params: {
        prompt: 'Test',
        size: '1920x1080',
        duration: 10,
        generateAudio: true,
      },
    };

    await createQwenVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.parameters.size).toBe('1920*1080');
    expect(body.parameters.duration).toBe(10);
    expect(body.parameters.audio).toBe(true);
  });

  it('should remove /compatible-mode/v1 suffix from baseURL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: { task_id: 'task-suffix-removal', task_status: 'PENDING' },
        request_id: 'req-444',
      }),
    });

    const options: CreateVideoOptions = {
      ...mockOptions,
      baseURL: 'https://custom-endpoint.com/compatible-mode/v1',
    };

    const payload: CreateVideoPayload = {
      model: 'wan2.2-t2v-plus',
      params: { prompt: 'Test' },
    };

    await createQwenVideo(payload, options);

    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).not.toContain('/compatible-mode/v1');
    expect(url).toContain('https://custom-endpoint.com');
  });

  it('should throw error when image required but missing for i2v model', async () => {
    const payload: CreateVideoPayload = {
      model: 'wan2.2-i2v-plus',
      params: {
        prompt: 'Animate this',
      },
    };

    await expect(createQwenVideo(payload, mockOptions)).rejects.toMatchObject({
      errorType: 'ProviderBizError',
      provider: 'qwen',
    });
  });

  it('should throw error when keyframe images required but missing', async () => {
    const payload: CreateVideoPayload = {
      model: 'wan2.2-kf2v-flash',
      params: {
        prompt: 'Transform',
      },
    };

    await expect(createQwenVideo(payload, mockOptions)).rejects.toMatchObject({
      errorType: 'ProviderBizError',
      provider: 'qwen',
    });
  });

  it('should throw error when vidu image required but missing', async () => {
    const payload: CreateVideoPayload = {
      model: 'vidu/viduq3-turbo_start-end2video',
      params: {
        prompt: 'Transform',
      },
    };

    await expect(createQwenVideo(payload, mockOptions)).rejects.toMatchObject({
      errorType: 'ProviderBizError',
      provider: 'qwen',
    });
  });
});

describe('pollQwenVideoStatus', () => {
  const apiKey = 'test-key';
  const baseUrl = 'https://dashscope.aliyuncs.com';

  it('should return success when task succeeded', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: {
          task_id: 'task-123',
          task_status: 'SUCCEEDED',
          video_url: 'https://cdn.qwen.com/video.mp4',
        },
        request_id: 'req-555',
      }),
    });

    const result = await pollQwenVideoStatus('task-123', apiKey, baseUrl);

    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://cdn.qwen.com/video.mp4',
    });
  });

  it('should return failed when task failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: {
          task_id: 'task-123',
          task_status: 'FAILED',
          error_message: 'Content policy violation',
        },
        request_id: 'req-666',
      }),
    });

    const result = await pollQwenVideoStatus('task-123', apiKey, baseUrl);

    expect(result).toEqual({
      status: 'failed',
      error: 'Content policy violation',
    });
  });

  it('should return pending when task running', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: {
          task_id: 'task-123',
          task_status: 'RUNNING',
        },
        request_id: 'req-777',
      }),
    });

    const result = await pollQwenVideoStatus('task-123', apiKey, baseUrl);

    expect(result).toEqual({ status: 'pending' });
  });

  it('should return failed when succeeded but no video URL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: {
          task_id: 'task-123',
          task_status: 'SUCCEEDED',
        },
        request_id: 'req-888',
      }),
    });

    const result = await pollQwenVideoStatus('task-123', apiKey, baseUrl);

    expect(result).toEqual({
      status: 'failed',
      error: 'Task succeeded but no video URL found',
    });
  });
});

describe('queryQwenVideoStatus', () => {
  it('should query task status endpoint', async () => {
    const mockResponse = {
      output: { task_id: 'task-123', task_status: 'RUNNING' },
      request_id: 'req-999',
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await queryQwenVideoStatus(
      'task-123',
      'test-key',
      'https://dashscope.aliyuncs.com',
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/tasks/task-123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-key',
        },
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(
      queryQwenVideoStatus('invalid-task', 'test-key', 'https://dashscope.aliyuncs.com'),
    ).rejects.toThrow('Failed to query task status');
  });
});
