// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload } from '../../types/image';
import { createZhipuImage, pollZhipuImageStatus, queryZhipuImageStatus } from './createImage';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('createZhipuImage', () => {
  const mockOptions: CreateImageOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    provider: 'zhipu',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create image with basic prompt', async () => {
    const mockTaskId = 'zhipu-task-123';
    const mockImageUrl = 'https://cdn.zhipu.ai/image.png';

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: mockTaskId }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_status: 'SUCCESS',
          image_result: [{ url: mockImageUrl }],
        }),
      });

    const payload: CreateImagePayload = {
      model: 'glm-image',
      params: {
        prompt: 'A cute cat',
      },
    };

    const result = await createZhipuImage(payload, mockOptions);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://open.bigmodel.cn/api/paas/v4/async/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
      }),
    );

    const submitBody = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(submitBody).toEqual({
      model: 'glm-image',
      prompt: 'A cute cat',
      watermark_enabled: false,
    });

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://open.bigmodel.cn/api/paas/v4/async-result/zhipu-task-123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
      }),
    );

    expect(result).toEqual({
      imageUrl: mockImageUrl,
    });
  });

  it('should create image via sync endpoint for cogview-4 model', async () => {
    const mockImageUrl = 'https://cdn.zhipu.ai/sync-image.png';

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        created: 123,
        data: [{ url: mockImageUrl }],
      }),
    });

    const payload: CreateImagePayload = {
      model: 'cogview-4',
      params: {
        prompt: 'A cute cat on window',
        resolution: 'standard',
        size: '1280x1280',
      },
    };

    const result = await createZhipuImage(payload, mockOptions);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
      }),
    );

    const submitBody = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(submitBody).toEqual({
      model: 'cogview-4',
      prompt: 'A cute cat on window',
      quality: 'standard',
      size: '1280x1280',
      watermark_enabled: false,
    });

    expect(result).toEqual({ imageUrl: mockImageUrl });
  });

  it('should convert width and height to size parameter', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'zhipu-task-456' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_status: 'SUCCESS',
          image_result: [{ url: 'https://cdn.zhipu.ai/size.png' }],
        }),
      });

    const payload: CreateImagePayload = {
      model: 'glm-image',
      params: {
        prompt: 'Landscape',
        height: 768,
        width: 1024,
      },
    };

    await createZhipuImage(payload, mockOptions);

    const submitBody = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(submitBody).toEqual({
      model: 'glm-image',
      prompt: 'Landscape',
      size: '1024x768',
      watermark_enabled: false,
    });
  });

  it('should respect explicit size and watermark parameter', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'zhipu-task-789' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_status: 'SUCCESS',
          image_result: [{ url: 'https://cdn.zhipu.ai/watermark.png' }],
        }),
      });

    const payload: CreateImagePayload = {
      model: 'glm-image',
      params: {
        prompt: 'Poster',
        size: '1024x1024',
        watermark: true,
        width: 512,
        height: 512,
      },
    };

    await createZhipuImage(payload, mockOptions);

    const submitBody = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(submitBody).toEqual({
      model: 'glm-image',
      prompt: 'Poster',
      size: '1024x1024',
      watermark_enabled: true,
    });
  });

  it('should throw on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => 'Insufficient credits',
    });

    const payload: CreateImagePayload = {
      model: 'glm-image',
      params: { prompt: 'Test' },
    };

    await expect(createZhipuImage(payload, mockOptions)).rejects.toThrow(
      'Zhipu image API error: 402 Insufficient credits',
    );
  });

  it('should throw when response is missing id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const payload: CreateImagePayload = {
      model: 'glm-image',
      params: { prompt: 'Test' },
    };

    await expect(createZhipuImage(payload, mockOptions)).rejects.toThrow(
      'Invalid response: missing task id',
    );
  });

  it('should throw when sync response is missing image url', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        created: 123,
        data: [],
      }),
    });

    const payload: CreateImagePayload = {
      model: 'cogview-4',
      params: { prompt: 'Test sync missing url' },
    };

    await expect(createZhipuImage(payload, mockOptions)).rejects.toThrow(
      'Invalid sync response: missing image URL',
    );
  });
});

describe('pollZhipuImageStatus', () => {
  const options = {
    apiKey: 'test-api-key',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  };

  it('should return success when task succeeded', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_status: 'SUCCESS',
        image_result: [{ url: 'https://cdn.zhipu.ai/success.png' }],
      }),
    });

    const result = await pollZhipuImageStatus('task-123', options);

    expect(result).toEqual({
      imageUrl: 'https://cdn.zhipu.ai/success.png',
    });
  });

  it('should throw when task failed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_status: 'FAIL',
        error: { message: 'Content moderation failed' },
      }),
    });

    await expect(pollZhipuImageStatus('task-123', options)).rejects.toThrow(
      'Content moderation failed',
    );
  });

  it('should keep polling when task is pending then succeed', async () => {
    vi.useFakeTimers();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ task_status: 'RUNNING' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_status: 'SUCCESS',
          image_result: [{ url: 'https://cdn.zhipu.ai/polled-success.png' }],
        }),
      });

    const resultPromise = pollZhipuImageStatus('task-123', options);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ imageUrl: 'https://cdn.zhipu.ai/polled-success.png' });
  });

  it('should throw when task succeeded but no image url', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task_status: 'SUCCESS',
        image_result: [],
      }),
    });

    await expect(pollZhipuImageStatus('task-123', options)).rejects.toThrow(
      'Task succeeded but no image URL found',
    );
  });
});

describe('queryZhipuImageStatus', () => {
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

    const result = await queryZhipuImageStatus('task-123', {
      apiKey: 'test-api-key',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/async-result/task-123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(result).toEqual(mockResponse);
  });
});
