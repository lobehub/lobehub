// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload } from '../../types/image';
import { createOpenRouterImage } from './createImage';

const imageBase64 = 'aW1hZ2U=';
const payload: CreateImagePayload = {
  model: 'bytedance-seed/seedream-4.5',
  params: { prompt: 'A red panda astronaut' },
};
const options: CreateImageOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://openrouter.ai/api/v1',
  maxRetries: 0,
  provider: 'openrouter',
};

let fetchMock: Mock<typeof fetch>;

const request = () => {
  const [input, init] = fetchMock.mock.calls[0];
  return new Request(input, init);
};

beforeEach(() => {
  fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ data: [{ b64_json: imageBase64 }] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createOpenRouterImage', () => {
  it('keeps existing synthetic image selections on the chat endpoint', async () => {
    const imageUrl = `data:image/png;base64,${imageBase64}`;
    fetchMock.mockResolvedValueOnce(
      Response.json({
        choices: [{ message: { images: [{ image_url: { url: imageUrl } }] } }],
      }),
    );

    const result = await createOpenRouterImage(
      { model: 'google/gemini-3-pro-image-preview:image', params: payload.params },
      options,
    );

    expect(result.imageUrl).toBe(imageUrl);
    expect(request().url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(await request().json()).toMatchObject({
      model: 'google/gemini-3-pro-image-preview',
      stream: false,
    });
  });
  it('posts JSON to the dedicated endpoint with auth and LobeHub attribution', async () => {
    const result = await createOpenRouterImage(payload, options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = request();
    expect(sent.url).toBe('https://openrouter.ai/api/v1/images');
    expect(sent.method).toBe('POST');
    expect(sent.headers.get('authorization')).toBe('Bearer test-api-key');
    expect(sent.headers.get('content-type')).toBe('application/json');
    expect(sent.headers.get('http-referer')).toBe('https://lobehub.com');
    expect(sent.headers.get('x-title')).toBe('LobeHub');
    expect(await sent.json()).toEqual({ model: payload.model, prompt: payload.params.prompt });
    expect(result).toEqual({ imageUrl: `data:image/png;base64,${imageBase64}` });
  });

  it('respects custom baseURL, fetch, headers and model mapping options', async () => {
    await createOpenRouterImage(payload, {
      ...options,
      baseURL: 'https://router.example.test/custom/v1/',
      defaultHeaders: { 'HTTP-Referer': 'https://example.test', 'X-Custom': 'custom-value' },
      fetch: fetchMock,
      modelIdMapping: { [payload.model]: 'custom/image-model' },
    });

    const sent = request();
    expect(sent.url).toBe('https://router.example.test/custom/v1/images');
    expect(sent.headers.get('http-referer')).toBe('https://example.test');
    expect(sent.headers.get('x-custom')).toBe('custom-value');
    expect(sent.headers.get('x-title')).toBe('LobeHub');
    expect(await sent.json()).toEqual({
      model: 'custom/image-model',
      prompt: payload.params.prompt,
    });
  });

  it('uses the default OpenRouter baseURL when none is configured', async () => {
    await createOpenRouterImage(payload, { ...options, baseURL: undefined });

    expect(request().url).toBe('https://openrouter.ai/api/v1/images');
  });

  it('explicitly translates supported controls without leaking generic or unknown parameters', async () => {
    const params = {
      ...payload.params,
      aspectRatio: '16:9',
      cfg: 7,
      image_config: { image_size: '0.5K' },
      modalities: ['image', 'text'],
      negativePrompt: 'blurry',
      output_format: 'jpeg',
      promptExtend: true,
      quality: 'high',
      resolution: '512',
      seed: 0,
      size: 'auto',
      steps: 30,
      unknownParameter: 'ignored',
      watermark: true,
      webSearch: true,
    };

    await createOpenRouterImage({ ...payload, params }, options);

    expect(await request().json()).toEqual({
      aspect_ratio: '16:9',
      model: payload.model,
      prompt: payload.params.prompt,
      quality: 'high',
      resolution: '512',
      seed: 0,
    });
  });

  it('omits a null seed rather than coercing it to zero', async () => {
    await createOpenRouterImage({ ...payload, params: { ...payload.params, seed: null } }, options);

    expect(await request().json()).toEqual({ model: payload.model, prompt: payload.params.prompt });
  });

  it('sends explicit pixel size without conflicting ratio or resolution', async () => {
    await createOpenRouterImage(
      {
        ...payload,
        params: {
          ...payload.params,
          aspectRatio: '16:9',
          height: 1024,
          resolution: '4K',
          size: '2048x2048',
          width: 1024,
        },
      },
      options,
    );

    expect(await request().json()).toEqual({
      model: payload.model,
      prompt: payload.params.prompt,
      size: '2048x2048',
    });
  });

  it('converts width and height to explicit size without conflicting ratio or resolution', async () => {
    await createOpenRouterImage(
      {
        ...payload,
        params: {
          ...payload.params,
          aspectRatio: '1:1',
          height: 768,
          resolution: '2K',
          size: 'auto',
          width: 1024,
        },
      },
      options,
    );

    expect(await request().json()).toEqual({
      model: payload.model,
      prompt: payload.params.prompt,
      size: '1024x768',
    });
  });

  it('combines a tier size with aspect ratio without sending a second resolution', async () => {
    await createOpenRouterImage(
      {
        ...payload,
        params: { ...payload.params, aspectRatio: '16:9', resolution: '4K', size: '2K' },
      },
      options,
    );

    expect(await request().json()).toEqual({
      aspect_ratio: '16:9',
      model: payload.model,
      prompt: payload.params.prompt,
      size: '2K',
    });
  });

  it('passes URL and data URI references using ContentPartImage rather than an edit endpoint', async () => {
    const imageUrls = ['https://example.test/reference.png', 'data:image/jpeg;base64,aW1hZ2U='];
    await createOpenRouterImage({ ...payload, params: { ...payload.params, imageUrls } }, options);

    expect(request().url).toBe('https://openrouter.ai/api/v1/images');
    expect(await request().json()).toEqual({
      input_references: imageUrls.map((url) => ({ image_url: { url }, type: 'image_url' })),
      model: payload.model,
      prompt: payload.params.prompt,
    });
  });

  it('falls back to a single imageUrl when the imageUrls list is empty', async () => {
    await createOpenRouterImage(
      {
        ...payload,
        params: {
          ...payload.params,
          imageUrl: 'https://example.test/reference.webp',
          imageUrls: [],
        },
      },
      options,
    );

    expect(await request().json()).toEqual({
      input_references: [
        { image_url: { url: 'https://example.test/reference.webp' }, type: 'image_url' },
      ],
      model: payload.model,
      prompt: payload.params.prompt,
    });
  });

  it('prefers imageUrls over the single-image fallback without duplicating references', async () => {
    await createOpenRouterImage(
      {
        ...payload,
        params: {
          ...payload.params,
          imageUrl: 'https://example.test/fallback.png',
          imageUrls: ['https://example.test/reference.png'],
        },
      },
      options,
    );

    expect((await request().json()).input_references).toEqual([
      { image_url: { url: 'https://example.test/reference.png' }, type: 'image_url' },
    ]);
  });

  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])(
    'uses the response MIME type %s in the data URI',
    async (mediaType) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ data: [{ b64_json: imageBase64, media_type: mediaType }] }),
      );

      expect(await createOpenRouterImage(payload, options)).toEqual({
        imageUrl: `data:${mediaType};base64,${imageBase64}`,
      });
    },
  );

  it('returns the first generated image and normalizes token usage and provider cost', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ b64_json: imageBase64 }, { b64_json: 'c2Vjb25k' }],
        usage: {
          completion_tokens: 42,
          completion_tokens_details: { image_tokens: 40, reasoning_tokens: 2 },
          cost: 0.04,
          prompt_tokens: 10,
          prompt_tokens_details: { image_tokens: 7 },
          total_tokens: 52,
        },
      }),
    );

    expect(await createOpenRouterImage(payload, options)).toEqual({
      imageUrl: `data:image/png;base64,${imageBase64}`,
      modelUsage: {
        cost: 0.04,
        inputImageTokens: 7,
        inputTextTokens: 3,
        outputImageTokens: 40,
        outputReasoningTokens: 2,
        totalInputTokens: 10,
        totalOutputTokens: 42,
        totalTokens: 52,
      },
    });
  });

  it('preserves an explicitly zero provider cost', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ b64_json: imageBase64 }],
        usage: { completion_tokens: 1, cost: 0, prompt_tokens: 0, total_tokens: 1 },
      }),
    );

    expect((await createOpenRouterImage(payload, options)).modelUsage?.cost).toBe(0);
  });

  it.each([
    null,
    {},
    { data: [] },
    { data: {} },
    { data: [null] },
    { data: [{}] },
    { data: [{ b64_json: '' }] },
    { data: [{ b64_json: '   ' }] },
    { data: [{ b64_json: 123 }] },
    { data: [{ url: 'https://example.test/not-the-documented-response.png' }] },
    { data: [{ b64_json: imageBase64, media_type: 'text/html' }] },
  ])('rejects an empty or malformed successful response: %j', async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));

    await expect(createOpenRouterImage(payload, options)).rejects.toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('Invalid OpenRouter image response'),
      }),
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });
  });

  it('preserves provider message, status, code and metadata in AgentRuntimeError', async () => {
    const providerError = {
      code: 402,
      message: 'Insufficient credits',
      metadata: { provider_name: 'Image Provider', raw: 'Upstream quota exceeded' },
    };
    fetchMock.mockResolvedValueOnce(Response.json({ error: providerError }, { status: 402 }));

    await expect(createOpenRouterImage(payload, options)).rejects.toMatchObject({
      error: expect.objectContaining({
        code: 402,
        error: providerError,
        message: expect.stringContaining('Insufficient credits'),
        status: 402,
      }),
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });
  });

  it('preserves provider errors returned inside a successful HTTP response', async () => {
    const error = {
      code: 502,
      message: 'Upstream image provider failed',
      metadata: { raw: 'Failure' },
    };
    fetchMock.mockResolvedValueOnce(Response.json({ error }));

    await expect(createOpenRouterImage(payload, options)).rejects.toEqual({
      error,
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });
  });

  it('wraps a non-JSON HTTP error without losing its status or response text', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Upstream unavailable', { status: 502 }));

    await expect(createOpenRouterImage(payload, options)).rejects.toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('Upstream unavailable'),
        status: 502,
      }),
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });
  });

  it('wraps malformed JSON and network failures as provider errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{invalid-json', { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(createOpenRouterImage(payload, options)).rejects.toMatchObject({
      error: expect.any(Error),
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });

    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(createOpenRouterImage(payload, options)).rejects.toMatchObject({
      error: expect.objectContaining({
        cause: expect.objectContaining({ message: 'Network unavailable' }),
      }),
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });
  });
});
