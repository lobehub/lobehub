// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../types/video';
import { createHunyuanVideo, pollHunyuanVideoStatus, queryHunyuanVideoStatus } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('createHunyuanVideo', () => {
  const mockOptions: CreateVideoOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://tokenhub.tencentmaas.com/v1',
    provider: 'hunyuan',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a text-to-video task', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'video-task-1', request_id: 'req-1' }),
    });

    const payload: CreateVideoPayload = {
      model: 'hy-video-1.5',
      params: {
        prompt: '一只小狗',
      },
    };

    const result = await createHunyuanVideo(payload, mockOptions);

    expect(result.inferenceId).toBe('hy-video-1.5::video-task-1');
    expect((global.fetch as any).mock.calls[0][0]).toBe(
      'https://tokenhub.tencentmaas.com/v1/api/video/submit',
    );
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
      model: 'hy-video-1.5',
      prompt: '一只小狗',
    });
  });
});

describe('Hunyuan video status helpers', () => {
  const apiKey = 'test-api-key';
  const baseURL = 'https://tokenhub.tencentmaas.com/v1';

  it('should query status with model and id from inferenceId', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        request_id: 'req-2',
        object: 'video',
        status: 'queued',
      }),
    });

    const result = await queryHunyuanVideoStatus('hy-video-1.5::video-task-4', apiKey, baseURL);

    expect((global.fetch as any).mock.calls[0][0]).toBe(
      'https://tokenhub.tencentmaas.com/v1/api/video/query',
    );
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
      model: 'hy-video-1.5',
      id: 'video-task-4',
    });
    expect(result).toEqual({ request_id: 'req-2', object: 'video', status: 'queued' });
  });

  it('should return success when query completes', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        request_id: 'req-3',
        status: 'completed',
        data: { url: 'https://example.com/video.mp4' },
      }),
    });

    const result = await pollHunyuanVideoStatus('hy-video-1.5::video-task-5', apiKey, baseURL);

    expect(result).toEqual({ status: 'success', videoUrl: 'https://example.com/video.mp4' });
  });

  it('should return pending for queued status', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        request_id: 'req-4',
        status: 'queued',
      }),
    });

    const result = await pollHunyuanVideoStatus('hy-video-1.5::video-task-6', apiKey, baseURL);

    expect(result).toEqual({ status: 'pending' });
  });

  it('should return failed when query returns failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        request_id: 'req-5',
        status: 'failed',
      }),
    });

    const result = await pollHunyuanVideoStatus('hy-video-1.5::video-task-7', apiKey, baseURL);

    expect(result).toEqual({ status: 'failed', error: 'Video generation failed' });
  });
});
