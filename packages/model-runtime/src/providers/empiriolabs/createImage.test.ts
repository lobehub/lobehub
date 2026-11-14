// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatible';
import type { CreateImagePayload } from '../../types/image';
import { createEmpirioLabsImage } from './createImage';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const imageResponse = (body: unknown) => ({ json: async () => body, ok: true });

const sentRequest = () => {
  const [url, init] = (global.fetch as any).mock.calls[0];

  return { body: JSON.parse(init.body), init, url };
};

describe('createEmpirioLabsImage', () => {
  const mockOptions: CreateImageOptions = {
    apiKey: 'test-api-key',
    baseURL: 'https://api.empiriolabs.ai/v1',
    provider: 'empiriolabs',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send a JSON request and return the image URL', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      imageResponse({
        created: 1_777_741_892,
        data: [{ url: 'https://media.example.com/image.webp' }],
      }),
    );

    const payload: CreateImagePayload = {
      model: 'flux-2-klein-4b',
      params: { prompt: 'A red bicycle' },
    };

    const result = await createEmpirioLabsImage(payload, mockOptions);

    const { body, init, url } = sentRequest();
    expect(url).toBe('https://api.empiriolabs.ai/v1/images/generations');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Authorization': 'Bearer test-api-key',
      'Content-Type': 'application/json',
    });
    expect(body).toEqual({ model: 'flux-2-klein-4b', prompt: 'A red bicycle' });
    expect(result).toEqual({ imageUrl: 'https://media.example.com/image.webp' });
  });

  it('should send the parameters under the names the API reads', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        imageResponse({ data: [{ url: 'https://media.example.com/a.webp' }] }),
      );

    await createEmpirioLabsImage(
      {
        model: 'flux-2-klein-4b',
        params: {
          aspectRatio: '16:9',
          cfg: 1,
          prompt: 'A red bicycle',
          promptExtend: true,
          quality: 'high',
          resolution: '2K',
          seed: 7,
          size: '1344x768',
          steps: 4,
          watermark: false,
        } as CreateImagePayload['params'],
      },
      mockOptions,
    );

    expect(sentRequest().body).toEqual({
      aspect_ratio: '16:9',
      guidance_scale: 1,
      model: 'flux-2-klein-4b',
      num_inference_steps: 4,
      prompt: 'A red bicycle',
      prompt_extend: true,
      quality: 'high',
      resolution: '2K',
      seed: 7,
      size: '1344x768',
      watermark: false,
    });
  });

  it('should leave out parameters that are not set', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        imageResponse({ data: [{ url: 'https://media.example.com/a.webp' }] }),
      );

    await createEmpirioLabsImage(
      {
        model: 'qwen-image-3-0',
        params: { imageUrl: null, prompt: 'A red bicycle', seed: null },
      },
      mockOptions,
    );

    expect(sentRequest().body).toEqual({ model: 'qwen-image-3-0', prompt: 'A red bicycle' });
  });

  it('should send a reference image as a list of URLs', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(imageResponse({ data: [{ url: 'https://media.example.com/b.png' }] }));

    await createEmpirioLabsImage(
      {
        model: 'seedream-5-0-flash',
        params: { imageUrl: 'https://files.example.com/input.png', prompt: 'Make it night' },
      },
      mockOptions,
    );

    expect(sentRequest().body).toEqual({
      image: ['https://files.example.com/input.png'],
      model: 'seedream-5-0-flash',
      prompt: 'Make it night',
    });
  });

  it('should send several reference images in the order given', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(imageResponse({ data: [{ url: 'https://media.example.com/c.png' }] }));

    await createEmpirioLabsImage(
      {
        model: 'seedream-5-0-flash',
        params: {
          imageUrls: ['https://files.example.com/1.png', 'https://files.example.com/2.png'],
          prompt: 'Combine them',
        },
      },
      mockOptions,
    );

    expect(sentRequest().body.image).toEqual([
      'https://files.example.com/1.png',
      'https://files.example.com/2.png',
    ]);
  });

  it('should use the configured base URL', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(imageResponse({ data: [{ url: 'https://media.example.com/d.png' }] }));

    await createEmpirioLabsImage(
      { model: 'flux-2-klein-4b', params: { prompt: 'A red bicycle' } },
      { ...mockOptions, baseURL: 'https://gateway.example.com/v1' },
    );

    expect(sentRequest().url).toBe('https://gateway.example.com/v1/images/generations');
  });

  it('should return an inline image as a data URL of its own type', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        imageResponse({ data: [{ b64_json: 'aGVsbG8=', content_type: 'image/webp' }] }),
      );

    const result = await createEmpirioLabsImage(
      { model: 'flux-2-klein-4b', params: { prompt: 'A red bicycle' } },
      mockOptions,
    );

    expect(result).toEqual({ imageUrl: 'data:image/webp;base64,aGVsbG8=' });
  });

  it('should report an invalid key as InvalidProviderAPIKey', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ error: { message: 'Invalid API key', type: 'authentication_error' } }),
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(
      createEmpirioLabsImage(
        { model: 'flux-2-klein-4b', params: { prompt: 'A red bicycle' } },
        mockOptions,
      ),
    ).rejects.toMatchObject({
      error: { error: { message: 'Invalid API key' }, status: 401 },
      errorType: 'InvalidProviderAPIKey',
      provider: 'empiriolabs',
    });
  });

  it('should report a rejected request as ProviderBizError with the API message', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => ({ error: { message: 'Unknown model', param: 'model' } }),
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    });

    await expect(
      createEmpirioLabsImage(
        { model: 'missing', params: { prompt: 'A red bicycle' } },
        mockOptions,
      ),
    ).rejects.toMatchObject({
      error: { error: { message: 'Unknown model', param: 'model' }, status: 400 },
      errorType: 'ProviderBizError',
      provider: 'empiriolabs',
    });
  });

  it('should report an error response that is not JSON', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: async () => {
        throw new Error('not json');
      },
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    });

    await expect(
      createEmpirioLabsImage(
        { model: 'flux-2-klein-4b', params: { prompt: 'A red bicycle' } },
        mockOptions,
      ),
    ).rejects.toMatchObject({
      error: { status: 502, statusText: 'Bad Gateway' },
      errorType: 'ProviderBizError',
    });
  });

  it('should name the job when the image is still being generated', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(imageResponse({ job_id: 'job-123', status: 'processing' }));

    await expect(
      createEmpirioLabsImage(
        { model: 'flux-2-klein-4b', params: { prompt: 'A red bicycle' } },
        mockOptions,
      ),
    ).rejects.toMatchObject({
      error: { job_id: 'job-123', message: 'The image is still being generated (job job-123)' },
      errorType: 'ProviderBizError',
      provider: 'empiriolabs',
    });
  });

  it('should fail when the response holds no image', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(imageResponse({ data: [] }));

    await expect(
      createEmpirioLabsImage(
        { model: 'flux-2-klein-4b', params: { prompt: 'A red bicycle' } },
        mockOptions,
      ),
    ).rejects.toMatchObject({
      error: { message: 'No images generated' },
      errorType: 'ProviderBizError',
    });
  });
});
