// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatible';
import type { CreateVideoPayload } from '../../types/video';
import { createEmpirioLabsVideo, pollEmpirioLabsVideoStatus } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const jsonResponse = (body: unknown) => ({ json: async () => body, ok: true });

const sentRequest = () => {
  const [url, init] = (global.fetch as any).mock.calls[0];

  return { body: init.body ? JSON.parse(init.body) : undefined, init, url };
};

describe('createEmpirioLabsVideo', () => {
  const mockOptions: CreateVideoOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://api.empiriolabs.ai/v1',
    provider: 'empiriolabs',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should submit a job and return its id for polling', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        job_id: 'job-123',
        poll_url: '/v1/jobs/job-123',
        status: 'processing',
      }),
    );

    const payload: CreateVideoPayload = {
      model: 'seedance-2-0-pro',
      params: { prompt: 'A futuristic city' },
    };

    const result = await createEmpirioLabsVideo(payload, mockOptions);

    const { body, init, url } = sentRequest();
    expect(url).toBe('https://api.empiriolabs.ai/v1/videos/generations');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Authorization': 'Bearer test-api-key',
      'Content-Type': 'application/json',
    });
    expect(body).toEqual({ model: 'seedance-2-0-pro', prompt: 'A futuristic city' });
    expect(result).toEqual({ inferenceId: 'job-123' });
  });

  it('should send the parameters under the names the API reads', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ job_id: 'job-456' }));

    await createEmpirioLabsVideo(
      {
        model: 'seedance-2-0-pro',
        params: {
          aspectRatio: '16:9',
          duration: 5,
          endImageUrl: 'https://files.example.com/last.png',
          generateAudio: true,
          imageUrl: 'https://files.example.com/first.png',
          imageUrls: ['https://files.example.com/ref-1.png', 'https://files.example.com/ref-2.png'],
          prompt: 'A futuristic city',
          promptExtend: false,
          resolution: '1080p',
          seed: 0,
          watermark: false,
        } as CreateVideoPayload['params'],
      },
      mockOptions,
    );

    expect(sentRequest().body).toEqual({
      aspect_ratio: '16:9',
      duration: 5,
      generate_audio: true,
      image: 'https://files.example.com/first.png',
      image_end: 'https://files.example.com/last.png',
      model: 'seedance-2-0-pro',
      prompt: 'A futuristic city',
      prompt_extend: false,
      reference_images: [
        'https://files.example.com/ref-1.png',
        'https://files.example.com/ref-2.png',
      ],
      resolution: '1080p',
      seed: 0,
      watermark: false,
    });
  });

  it('should send a size as the resolution when no resolution is set', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ job_id: 'job-789' }));

    await createEmpirioLabsVideo(
      {
        model: 'svi-2-0-pro',
        params: { prompt: 'A futuristic city', size: '832x480' } as CreateVideoPayload['params'],
      },
      mockOptions,
    );

    expect(sentRequest().body).toEqual({
      model: 'svi-2-0-pro',
      prompt: 'A futuristic city',
      resolution: '832x480',
    });
  });

  it.each([
    ['wan-3-0', 'audio'],
    ['kling-v3', 'sound'],
    ['pixverse-v6', 'generate_audio_switch'],
    ['seedance-2-0-pro', 'generate_audio'],
    ['a-model-added-later', 'generate_audio'],
  ])('should send the audio switch of %s as %s', async (model, field) => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ job_id: 'job-audio' }));

    await createEmpirioLabsVideo(
      { model, params: { generateAudio: false, prompt: 'A futuristic city' } },
      mockOptions,
    );

    expect(sentRequest().body).toEqual({ [field]: false, model, prompt: 'A futuristic city' });
  });

  it('should use the configured base URL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ job_id: 'job-123' }));

    await createEmpirioLabsVideo(
      { model: 'seedance-2-0-pro', params: { prompt: 'A futuristic city' } },
      { ...mockOptions, baseURL: 'https://gateway.example.com/v1' },
    );

    expect(sentRequest().url).toBe('https://gateway.example.com/v1/videos/generations');
  });

  it('should report a rejected request as ProviderBizError', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"Unknown model"}}',
    });

    await expect(
      createEmpirioLabsVideo({ model: 'missing', params: { prompt: 'A city' } }, mockOptions),
    ).rejects.toMatchObject({
      error: {
        message: 'EmpirioLabs AI video API error: 400 {"error":{"message":"Unknown model"}}',
      },
      errorType: 'ProviderBizError',
      provider: 'empiriolabs',
    });
  });

  it('should fail when the response holds no job id', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ status: 'processing' }));

    await expect(
      createEmpirioLabsVideo(
        { model: 'seedance-2-0-pro', params: { prompt: 'A city' } },
        mockOptions,
      ),
    ).rejects.toMatchObject({
      error: { message: 'Invalid response: missing job_id' },
      errorType: 'ProviderBizError',
    });
  });
});

describe('pollEmpirioLabsVideoStatus', () => {
  const options = { apiKey: 'test-api-key', baseURL: 'https://api.empiriolabs.ai/v1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read the job with the API key', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-123', status: 'processing' }));

    const result = await pollEmpirioLabsVideoStatus('job-123', options);

    const { init, url } = sentRequest();
    expect(url).toBe('https://api.empiriolabs.ai/v1/jobs/job-123');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-api-key' });
    expect(result).toEqual({ status: 'pending' });
  });

  it('should fall back to the default base URL', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-123', status: 'processing' }));

    await pollEmpirioLabsVideoStatus('job-123', { apiKey: 'test-api-key' });

    expect(sentRequest().url).toBe('https://api.empiriolabs.ai/v1/jobs/job-123');
  });

  it('should return the video URL of a completed job', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        job_id: 'job-123',
        result: { data: [{ url: 'https://media.example.com/video.mp4' }] },
        status: 'completed',
      }),
    );

    expect(await pollEmpirioLabsVideoStatus('job-123', options)).toEqual({
      status: 'success',
      videoUrl: 'https://media.example.com/video.mp4',
    });
  });

  it('should fail a completed job that holds no video URL', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ job_id: 'job-123', result: { data: [] }, status: 'completed' }),
      );

    expect(await pollEmpirioLabsVideoStatus('job-123', options)).toEqual({
      error: 'Job completed but no video URL found',
      status: 'failed',
    });
  });

  it('should return the message of a failed job', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        error: { message: 'The prompt was rejected', type: 'invalid_request_error' },
        job_id: 'job-123',
        status: 'failed',
      }),
    );

    expect(await pollEmpirioLabsVideoStatus('job-123', options)).toEqual({
      error: 'The prompt was rejected',
      status: 'failed',
    });
  });

  it('should use a default message for a failed job without one', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-123', status: 'failed' }));

    expect(await pollEmpirioLabsVideoStatus('job-123', options)).toEqual({
      error: 'Video generation failed',
      status: 'failed',
    });
  });

  it('should stop polling a cancelled job', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job-123', status: 'cancelled' }));

    expect(await pollEmpirioLabsVideoStatus('job-123', options)).toEqual({
      error: 'Video generation was cancelled',
      status: 'failed',
    });
  });

  it('should throw when the job cannot be read', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    });

    await expect(pollEmpirioLabsVideoStatus('job-123', options)).rejects.toThrow(
      'EmpirioLabs AI job status API error: 404 Not found',
    );
  });
});
