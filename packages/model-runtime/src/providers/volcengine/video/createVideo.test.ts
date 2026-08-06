import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../../types/video';
import { createVolcengineVideo, pollVolcengineVideoStatus } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createVolcengineVideo', () => {
  let payload: CreateVideoPayload;
  let options: CreateVideoOptions;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VOLCENGINE_VIDEO_USE_WEBHOOK;

    payload = {
      model: 'doubao-video-model',
      params: {
        prompt: 'a beautiful sunset over the ocean',
      },
    };

    options = {
      apiKey: 'test-api-key',
      provider: 'volcengine',
    };
  });

  describe('successful creation', () => {
    it('should return inferenceId on success', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-abc-123' }),
        ok: true,
      });

      const result = await createVolcengineVideo(payload, options);

      expect(result).toEqual({ inferenceId: 'task-abc-123', useWebhook: true });
    });

    it('should return useWebhook: true to indicate webhook-based async flow', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-webhook' }),
        ok: true,
      });

      const result = await createVolcengineVideo(payload, options);

      expect((result as any).useWebhook).toBe(true);
    });
  });

  describe('webhook toggle via VOLCENGINE_VIDEO_USE_WEBHOOK', () => {
    it('should default to webhook flow and attach callback_url when unset', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-1' }),
        ok: true,
      });
      payload.callbackUrl = 'https://example.com/webhook';

      const result = await createVolcengineVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.callback_url).toBe('https://example.com/webhook');
      expect((result as any).useWebhook).toBe(true);
    });

    it('should keep webhook flow when explicitly set to "1"', async () => {
      process.env.VOLCENGINE_VIDEO_USE_WEBHOOK = '1';
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-1' }),
        ok: true,
      });
      payload.callbackUrl = 'https://example.com/webhook';

      const result = await createVolcengineVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.callback_url).toBe('https://example.com/webhook');
      expect((result as any).useWebhook).toBe(true);
    });

    it('should disable webhook and omit callback_url when set to "0"', async () => {
      process.env.VOLCENGINE_VIDEO_USE_WEBHOOK = '0';
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-poll' }),
        ok: true,
      });
      payload.callbackUrl = 'https://example.com/webhook';

      const result = await createVolcengineVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.callback_url).toBeUndefined();
      expect(result).toEqual({ inferenceId: 'task-poll' });
      expect((result as any).useWebhook).toBeUndefined();
    });
  });

    it('should send minimal body with only prompt', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-1' }),
        ok: true,
      });

      await createVolcengineVideo(payload, options);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.content).toEqual([{ text: 'a beautiful sunset over the ocean', type: 'text' }]);
      expect(body.model).toBe('doubao-video-model');
      expect(body.watermark).toBe(false);
      // Should not include optional params
      expect(body.ratio).toBeUndefined();
      expect(body.duration).toBeUndefined();
      expect(body.seed).toBeUndefined();
    });
  });

  describe('content array', () => {
    it('should add first_frame entry when imageUrl is provided', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-1' }),
        ok: true,
      });

      payload.params.imageUrl = 'https://example.com/start.jpg';

      await createVolcengineVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toHaveLength(2);
      expect(body.content[1]).toEqual({
        image_url: { url: 'https://example.com/start.jpg' },
        role: 'first_frame',
        type: 'image_url',
      });
    });

    it('should add last_frame entry when endImageUrl is provided', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-1' }),
        ok: true,
      });

      payload.params.endImageUrl = 'https://example.com/end.jpg';

      await createVolcengineVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toHaveLength(2);
      expect(body.content[1]).toEqual({
        image_url: { url: 'https://example.com/end.jpg' },
        role: 'last_frame',
        type: 'image_url',
      });
    });

    it('should have 3 content elements when both imageUrl and endImageUrl are provided', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-1' }),
        ok: true,
      });

      payload.params.imageUrl = 'https://example.com/start.jpg';
      payload.params.endImageUrl = 'https://example.com/end.jpg';

      await createVolcengineVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toHaveLength(3);
      expect(body.content[0].type).toBe('text');
      expect(body.content[1].role).toBe('first_frame');
      expect(body.content[2].role).toBe('last_frame');
    });
  });

  describe('optional params', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-1' }),
        ok: true,
      });
    });

    it('should map aspectRatio to body.ratio', async () => {
      payload.params.aspectRatio = '16:9';
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.ratio).toBe('16:9');
    });

    it('should map duration to body.duration', async () => {
      payload.params.duration = 5;
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.duration).toBe(5);
    });

    it('should map generateAudio to body.generate_audio', async () => {
      payload.params.generateAudio = true;
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generate_audio).toBe(true);
    });

    it('should disable web search tool by default when webSearch is undefined', async () => {
      payload.model = 'doubao-seedance-2-0-fast-260128';
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
    });

    it('should enable web search tool when webSearch is true', async () => {
      payload.model = 'doubao-seedance-2-0-fast-260128';
      payload.params.webSearch = true;
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toEqual([{ type: 'web_search' }]);
    });

    it('should disable web search tool when webSearch is false', async () => {
      payload.model = 'doubao-seedance-2-0-fast-260128';
      payload.params.webSearch = false;
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
    });

    it('should map seed to body.seed', async () => {
      payload.params.seed = 42;
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.seed).toBe(42);
    });

    it('should not include seed when seed is null', async () => {
      payload.params.seed = null;
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.seed).toBeUndefined();
    });

    it('should map resolution to body.resolution', async () => {
      payload.params.resolution = '1080p';
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.resolution).toBe('1080p');
    });

    it('should map cameraFixed to body.camera_fixed', async () => {
      payload.params.cameraFixed = true;
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.camera_fixed).toBe(true);
    });

    it('should map callbackUrl to body.callback_url', async () => {
      payload.callbackUrl = 'https://example.com/webhook';
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.callback_url).toBe('https://example.com/webhook');
    });

    it('should allow overriding watermark when watermark is provided', async () => {
      payload.params.watermark = true;
      await createVolcengineVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.watermark).toBe(true);
    });
  });

  describe('client config', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: 'task-1' }),
        ok: true,
      });
    });

    it('should use default baseURL', async () => {
      await createVolcengineVideo(payload, options);

      const fetchUrl = mockFetch.mock.calls[0][0];
      expect(fetchUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
    });

    it('should use custom baseURL when provided', async () => {
      options.baseURL = 'https://custom-endpoint.com/api/v3';
      await createVolcengineVideo(payload, options);

      const fetchUrl = mockFetch.mock.calls[0][0];
      expect(fetchUrl).toBe('https://custom-endpoint.com/api/v3/contents/generations/tasks');
    });

    it('should send Authorization Bearer header', async () => {
      await createVolcengineVideo(payload, options);

      const fetchHeaders = mockFetch.mock.calls[0][1].headers;
      expect(fetchHeaders['Authorization']).toBe('Bearer test-api-key');
      expect(fetchHeaders['Content-Type']).toBe('application/json');
    });
  });

  describe('error handling', () => {
    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      await expect(createVolcengineVideo(payload, options)).rejects.toThrow(
        'Volcengine video API error: 429 Rate limit exceeded',
      );
    });

    it('should throw when response has no id', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({}),
        ok: true,
      });

      await expect(createVolcengineVideo(payload, options)).rejects.toThrow(
        'Invalid response: missing task id',
      );
    });
  });
});

describe('pollVolcengineVideoStatus', () => {
  let options: CreateVideoOptions;

  beforeEach(() => {
    vi.clearAllMocks();
    options = {
      apiKey: 'test-api-key',
      provider: 'volcengine',
    };
  });

  it('should GET the task status endpoint with Authorization header', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ id: 'task-1', status: 'running' }),
      ok: true,
    });

    await pollVolcengineVideoStatus('task-1', options);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task-1',
    );
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-api-key');
  });

  it('should return success with videoUrl when succeeded', async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          content: { video_url: 'https://cdn.example.com/v.mp4' },
          id: 'task-1',
          status: 'succeeded',
        }),
      ok: true,
    });

    const result = await pollVolcengineVideoStatus('task-1', options);

    expect(result).toEqual({ status: 'success', videoUrl: 'https://cdn.example.com/v.mp4' });
  });

  it('should return failed when succeeded but missing video_url', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ id: 'task-1', status: 'succeeded' }),
      ok: true,
    });

    const result = await pollVolcengineVideoStatus('task-1', options);

    expect(result.status).toBe('failed');
  });

  it('should return failed with error message when failed', async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({ error: { message: 'content moderation' }, id: 'task-1', status: 'failed' }),
      ok: true,
    });

    const result = await pollVolcengineVideoStatus('task-1', options);

    expect(result).toEqual({ error: 'content moderation', status: 'failed' });
  });

  it('should return failed for expired task', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ id: 'task-1', status: 'expired' }),
      ok: true,
    });

    const result = await pollVolcengineVideoStatus('task-1', options);

    expect(result).toEqual({ error: 'Video generation task expired', status: 'failed' });
  });

  it('should return pending for queued / running status', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ id: 'task-1', status: 'queued' }),
      ok: true,
    });

    const result = await pollVolcengineVideoStatus('task-1', options);

    expect(result).toEqual({ status: 'pending' });
  });

  it('should use custom baseURL when provided', async () => {
    options.baseURL = 'https://custom-endpoint.com/api/v3';
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ id: 'task-1', status: 'running' }),
      ok: true,
    });

    await pollVolcengineVideoStatus('task-1', options);

    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://custom-endpoint.com/api/v3/contents/generations/tasks/task-1',
    );
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    await expect(pollVolcengineVideoStatus('task-1', options)).rejects.toThrow(
      'Volcengine video status API error: 404 Not Found',
    );
  });
});
