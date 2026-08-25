// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import {
  createMiniMaxVideo,
  pollMiniMaxVideoStatus,
  queryMiniMaxH3VideoStatus,
  queryMiniMaxVideoStatus,
  retrieveMiniMaxVideoFile,
} from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('createMiniMaxVideo', () => {
  const mockOptions: CreateVideoOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://api.minimaxi.com/v1',
    provider: 'minimax',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create video with basic prompt', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_id: 'minimax-task-123',
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'video-01',
      params: {
        prompt: 'A beautiful landscape',
      },
    };

    const result = await createMiniMaxVideo(payload, mockOptions);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v1/video_generation',
      expect.any(Object),
    );
    expect(result).toEqual({ inferenceId: 'minimax-task-123' });
  });

  it('should include custom duration', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_id: 'task-custom-duration',
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'video-01',
      params: {
        prompt: 'Test',
        duration: 10,
      },
    };

    await createMiniMaxVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.duration).toBe(10);
  });

  it('should include imageUrl as first_frame_image', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_id: 'task-image-input',
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'video-01',
      params: {
        prompt: 'Animate this',
        imageUrl: 'https://example.com/first.jpg',
      },
    };

    await createMiniMaxVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.first_frame_image).toBe('https://example.com/first.jpg');
  });

  it('should include endImageUrl as last_frame_image', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_id: 'task-two-images',
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'video-01',
      params: {
        prompt: 'Transform',
        imageUrl: 'https://example.com/first.jpg',
        endImageUrl: 'https://example.com/last.jpg',
      },
    };

    await createMiniMaxVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.first_frame_image).toBe('https://example.com/first.jpg');
    expect(body.last_frame_image).toBe('https://example.com/last.jpg');
  });

  it('should throw on non-zero status_code', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_id: 'task-error',
        base_resp: { status_code: 4001, status_msg: 'Invalid prompt' },
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'video-01',
      params: { prompt: 'Test' },
    };

    await expect(createMiniMaxVideo(payload, mockOptions)).rejects.toThrow(
      'MiniMax video API error: Invalid prompt',
    );
  });

  it('should throw when missing task_id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    });

    const payload: CreateVideoPayload = {
      model: 'video-01',
      params: { prompt: 'Test' },
    };

    await expect(createMiniMaxVideo(payload, mockOptions)).rejects.toThrow(
      'Invalid response: missing task_id',
    );
  });

  it('should create MiniMax-H3 video with the v2 content API', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_id: 'h3-task-123' }),
    });

    const payload: CreateVideoPayload = {
      model: 'MiniMax-H3',
      params: {
        aspectRatio: '9:16',
        duration: 12,
        prompt: 'A cinematic city at night',
        resolution: '2K',
        watermark: true,
      },
    };

    const result = await createMiniMaxVideo(payload, mockOptions);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v2/video_generation',
      expect.any(Object),
    );
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toEqual({
      aigc_watermark: true,
      content: [{ text: 'A cinematic city at night', type: 'text' }],
      duration: 12,
      model: 'MiniMax-H3',
      ratio: '9:16',
      resolution: '2K',
    });
    expect(result).toEqual({ inferenceId: 'MiniMax-H3::h3-task-123' });
  });

  it('should map MiniMax-H3 first and last frames and use adaptive ratio', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_id: 'h3-frames-task' }),
    });

    const payload: CreateVideoPayload = {
      model: 'MiniMax-H3',
      params: {
        aspectRatio: '16:9',
        endImageUrl: 'https://example.com/last.jpg',
        imageUrl: 'https://example.com/first.jpg',
        prompt: 'Smoothly transition between these frames',
      },
    };

    await createMiniMaxVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.ratio).toBe('adaptive');
    expect(body.content).toEqual([
      { text: 'Smoothly transition between these frames', type: 'text' },
      {
        image_url: { url: 'https://example.com/first.jpg' },
        role: 'first_frame',
        type: 'image_url',
      },
      {
        image_url: { url: 'https://example.com/last.jpg' },
        role: 'last_frame',
        type: 'image_url',
      },
    ]);
  });

  it('should normalize all visible H3 inputs into reference images', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task_id: 'h3-reference-task' }),
    });

    const payload: CreateVideoPayload = {
      model: 'MiniMax-H3',
      params: {
        aspectRatio: '1:1',
        endImageUrl: 'https://example.com/ignored-last.jpg',
        imageUrl: 'https://example.com/ignored-first.jpg',
        imageUrls: ['https://example.com/reference-1.jpg', 'https://example.com/reference-2.jpg'],
        prompt: 'Keep the referenced characters consistent',
      },
    };

    await createMiniMaxVideo(payload, mockOptions);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.ratio).toBe('1:1');
    expect(body.content).toEqual([
      { text: 'Keep the referenced characters consistent', type: 'text' },
      {
        image_url: { url: 'https://example.com/ignored-first.jpg' },
        role: 'reference_image',
        type: 'image_url',
      },
      {
        image_url: { url: 'https://example.com/reference-1.jpg' },
        role: 'reference_image',
        type: 'image_url',
      },
      {
        image_url: { url: 'https://example.com/reference-2.jpg' },
        role: 'reference_image',
        type: 'image_url',
      },
      {
        image_url: { url: 'https://example.com/ignored-last.jpg' },
        role: 'reference_image',
        type: 'image_url',
      },
    ]);
  });

  it('should reject more than nine normalized H3 reference images', async () => {
    const payload: CreateVideoPayload = {
      model: 'MiniMax-H3',
      params: {
        endImageUrl: 'https://example.com/last.jpg',
        imageUrl: 'https://example.com/first.jpg',
        imageUrls: Array.from(
          { length: 8 },
          (_, index) => `https://example.com/reference-${index}.jpg`,
        ),
        prompt: 'Keep every visible reference',
      },
    };

    await expect(createMiniMaxVideo(payload, mockOptions)).rejects.toThrow(
      'MiniMax-H3 supports up to 9 reference images',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('pollMiniMaxVideoStatus', () => {
  const options = {
    apiKey: 'test-key',
    baseURL: 'https://api.minimaxi.com/v1',
  };

  it('should return success when task succeeded', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'Success',
          file_id: 'file-123',
          task_id: 'task-123',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          file: { download_url: 'https://cdn.minimax.com/video.mp4' },
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      });

    const result = await pollMiniMaxVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://cdn.minimax.com/video.mp4',
    });
  });

  it('should return failed when task failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'Fail',
        base_resp: { status_code: 500, status_msg: 'Processing error' },
      }),
    });

    const result = await pollMiniMaxVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Processing error',
    });
  });

  it('should return pending when task in progress', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'Processing',
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    });

    const result = await pollMiniMaxVideoStatus('task-123', options);

    expect(result).toEqual({ status: 'pending' });
  });

  it('should return failed when succeeded but no file_id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'Success',
        task_id: 'task-123',
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    });

    const result = await pollMiniMaxVideoStatus('task-123', options);

    expect(result).toEqual({
      status: 'failed',
      error: 'Task succeeded but no file_id found',
    });
  });

  it('should return MiniMax-H3 result directly from the v2 task response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: {
          content: { url: 'https://cdn.minimax.com/h3-video.mp4' },
          id: 'h3-task-123',
          model: 'MiniMax-H3',
          status: 'succeeded',
        },
      }),
    });

    const result = await pollMiniMaxVideoStatus('MiniMax-H3::h3-task-123', options);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v2/query/video_generation/h3-task-123',
      expect.any(Object),
    );
    expect(result).toEqual({
      status: 'success',
      videoUrl: 'https://cdn.minimax.com/h3-video.mp4',
    });
  });

  it.each(['queued', 'running'])(
    'should return pending for MiniMax-H3 %s tasks',
    async (status) => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task: { id: 'h3-task-123', model: 'MiniMax-H3', status },
        }),
      });

      const result = await pollMiniMaxVideoStatus('MiniMax-H3::h3-task-123', options);

      expect(result).toEqual({ status: 'pending' });
    },
  );

  it.each(['failed', 'expired'])('should return failed for MiniMax-H3 %s tasks', async (status) => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: {
          error: { message: 'Generation failed' },
          id: 'h3-task-123',
          model: 'MiniMax-H3',
          status,
        },
      }),
    });

    const result = await pollMiniMaxVideoStatus('MiniMax-H3::h3-task-123', options);

    expect(result).toEqual({ error: 'Generation failed', status: 'failed' });
  });
});

describe('queryMiniMaxVideoStatus', () => {
  it('should query status endpoint with task_id param', async () => {
    const mockResponse = {
      status: 'Success',
      task_id: 'task-123',
      base_resp: { status_code: 0, status_msg: 'success' },
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await queryMiniMaxVideoStatus('task-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.minimaxi.com/v1',
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/query/video_generation?task_id=task-123'),
      expect.any(Object),
    );
    expect(result).toEqual(mockResponse);
  });
});

describe('queryMiniMaxH3VideoStatus', () => {
  it('should query the v2 path with an encoded task id', async () => {
    const mockResponse = {
      task: { id: 'h3/task', model: 'MiniMax-H3', status: 'running' as const },
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await queryMiniMaxH3VideoStatus('h3/task', {
      apiKey: 'test-key',
      baseURL: 'https://api.minimaxi.com/v1',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v2/query/video_generation/h3%2Ftask',
      expect.any(Object),
    );
    expect(result).toEqual(mockResponse);
  });
});

describe('retrieveMiniMaxVideoFile', () => {
  it('should retrieve file download URL', async () => {
    const mockResponse = {
      file: {
        download_url: 'https://cdn.minimax.com/video.mp4',
        file_id: 'file-123',
      },
      base_resp: { status_code: 0, status_msg: 'success' },
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await retrieveMiniMaxVideoFile('file-123', {
      apiKey: 'test-key',
      baseURL: 'https://api.minimaxi.com/v1',
    });

    expect(result).toBe('https://cdn.minimax.com/video.mp4');
  });

  it('should throw on non-zero status_code', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        base_resp: { status_code: 404, status_msg: 'File not found' },
      }),
    });

    await expect(
      retrieveMiniMaxVideoFile('invalid-file', {
        apiKey: 'test-key',
        baseURL: 'https://api.minimaxi.com/v1',
      }),
    ).rejects.toThrow('MiniMax file retrieve error: File not found');
  });

  it('should throw when missing download_url', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: {},
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    });

    await expect(
      retrieveMiniMaxVideoFile('file-123', {
        apiKey: 'test-key',
        baseURL: 'https://api.minimaxi.com/v1',
      }),
    ).rejects.toThrow('Missing download_url in MiniMax file retrieve response');
  });
});
