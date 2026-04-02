// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import { createWenxinVideo, pollWenxinVideoStatus, queryWenxinVideoStatus } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('createWenxinVideo', () => {
  const mockOptions: CreateVideoOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://qianfan.baidubce.com',
    provider: 'wenxin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create video with basic prompt', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_id: 'wenxin-task-123' }),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: {
        prompt: 'A beautiful landscape',
      },
    };

    const result = await createWenxinVideo(payload, mockOptions);

    expect(fetch).toHaveBeenCalledWith(
      'https://qianfan.baidubce.com/video/generations',
      expect.any(Object),
    );
    expect(result).toEqual({ inferenceId: 'wenxin-task-123' });
  });

  it('should build content array with text', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_id: 'wenxin-text-only' }),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: {
        prompt: 'Test prompt',
      },
    };

    await createWenxinVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.content).toEqual([{ type: 'text', text: 'Test prompt' }]);
  });

  it('should add image_url entry when imageUrl provided', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_id: 'wenxin-image2vid' }),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: {
        prompt: 'Animate this',
        imageUrl: 'https://example.com/image.jpg',
      },
    };

    await createWenxinVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.content).toHaveLength(2);
    expect(body.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    });
  });

  it('should include optional parameters', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_id: 'wenxin-full' }),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: {
        prompt: 'Test',
        aspectRatio: '16:9',
        duration: 10,
        generateAudio: true,
      },
    };

    await createWenxinVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.aspect_ratio).toBe('16:9');
    expect(body.duration).toBe(10);
    expect(body.generate_audio).toBe(true);
  });

  it('should remove /v2 suffix from baseURL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_id: 'wenxin-v2-removal' }),
    });

    const options: CreateVideoOptions = {
      ...mockOptions,
      baseURL: 'https://custom.baidubce.com/v2',
    };

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: { prompt: 'Test' },
    };

    await createWenxinVideo(payload, options);

    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).not.toContain('/v2');
    expect(url).toContain('https://custom.baidubce.com/video/generations');
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid parameters',
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: { prompt: 'Test' },
    };

    await expect(createWenxinVideo(payload, mockOptions)).rejects.toThrow(
      'Wenxin video API error: 400 Invalid parameters',
    );
  });

  it('should throw when response missing task_id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const payload: CreateVideoPayload = {
      model: 'cogvideox',
      params: { prompt: 'Test' },
    };

    await expect(createWenxinVideo(payload, mockOptions)).rejects.toThrow(
      'Invalid response: missing task_id',
    );
  });
});

describe('pollWenxinVideoStatus', () => {
  const options = {
    apiKey: 'test-key',
    baseURL: 'https://qianfan.baidubce.com',
  };

  it('should return success when status is succeeded', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'succeeded',
        content: { video_url: 'https://cdn.wenxin.com/video.mp4' },
      }),
    });

    const result = await pollWenxinVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://cdn.wenxin.com/video.mp4',
    });
  });

  it('should return failed when status is failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'failed' }),
    });

    const result = await pollWenxinVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Video generation failed',
    });
  });

  it('should return pending when status is processing', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'processing' }),
    });

    const result = await pollWenxinVideoStatus('task-123', options);

    expect(result).toEqual({ status: 'pending' });
  });

  it('should return failed when succeeded but no video URL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'succeeded',
        content: {},
      }),
    });

    const result = await pollWenxinVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Task succeeded but no video URL found',
    });
  });
});

describe('queryWenxinVideoStatus', () => {
  it('should query status endpoint with task_id query param', async () => {
    const mockResponse = {
      status: 'processing',
      task_id: 'task-123',
      width: 1920,
      height: 1080,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await queryWenxinVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'https://qianfan.baidubce.com',
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/video/generations?task_id=task-123'),
      expect.any(Object),
    );
    expect(result).toEqual(mockResponse);
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Task not found',
    });

    await expect(
      queryWenxinVideoStatus('invalid-task', {
        apiKey: 'test-key',
        baseURL: 'https://qianfan.baidubce.com',
      }),
    ).rejects.toThrow('Wenxin status API error: 404 Task not found');
  });

  it('should not include /v2 in the polling URL when baseURL contains /v2', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'processing', task_id: 'task-v2' }),
    });

    await queryWenxinVideoStatus('task-v2', {
      apiKey: 'test-key',
      baseURL: 'https://qianfan.baidubce.com',
    });

    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toBe('https://qianfan.baidubce.com/video/generations?task_id=task-v2');
    expect(url).not.toContain('/v2/');
  });
});
