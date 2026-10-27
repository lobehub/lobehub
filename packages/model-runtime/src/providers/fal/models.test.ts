// @vitest-environment node
import { fal } from '@fal-ai/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFalInputSchemaCache, FAL_INPUT_SCHEMA_TTL_MS, getFalInputSchema } from './catalog';
import { LobeFalAI } from './index';
import { buildFalCatalogResponse, buildFalOpenAPI } from './testUtils';

vi.mock('@fal-ai/client', () => ({
  createFalClient: vi.fn(() => ({})),
  fal: { config: vi.fn(), subscribe: vi.fn() },
}));

const mockFal = vi.mocked(fal);

let instance: LobeFalAI;

beforeEach(() => {
  vi.clearAllMocks();
  clearFalInputSchemaCache();
  // No test reaches fal's real catalog API; tests that need a schema stub their own
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 500 })),
  );
  instance = new LobeFalAI({ apiKey: 'test-api-key' });
  mockFal.subscribe.mockResolvedValue({
    data: { images: [{ url: 'https://example.com/out.png' }] },
    requestId: 'r',
  } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Serve one endpoint's input schema from the catalog, or fail when no properties are given */
const stubInputSchema = (endpointId: string, properties?: Record<string, any>) => {
  const fetchMock = vi.fn(async () =>
    properties
      ? new Response(JSON.stringify(buildFalCatalogResponse(endpointId, properties)))
      : new Response('{}', { status: 500 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('LobeFalAI createImage with any fal endpoint', () => {
  it('sends endpoints from other owners verbatim', async () => {
    stubInputSchema('black-forest-labs/flux-2-pro');

    await instance.createImage({
      model: 'black-forest-labs/flux-2-pro',
      params: { prompt: 'a fox' },
    });

    expect(mockFal.subscribe).toHaveBeenCalledWith('black-forest-labs/flux-2-pro', {
      input: { enable_safety_checker: false, num_images: 1, prompt: 'a fox' },
    });
  });

  it('sends the aspect ratio under the field fal reads', async () => {
    await instance.createImage({
      model: 'fal-ai/flux-pro/kontext',
      params: { aspectRatio: '16:9', prompt: 'a fox' },
    });

    expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux-pro/kontext', {
      input: expect.objectContaining({ aspect_ratio: '16:9' }),
    });
  });

  it('passes a native resolution through instead of converting it to a size', async () => {
    await instance.createImage({
      model: 'fal-ai/nano-banana-pro',
      params: { aspectRatio: '1:1', prompt: 'a fox', resolution: '2K' },
    });

    expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/nano-banana-pro', {
      input: expect.objectContaining({ aspect_ratio: '1:1', resolution: '2K' }),
    });
  });

  it('accelerates FLUX Krea by its full endpoint id', async () => {
    await instance.createImage({ model: 'fal-ai/flux/krea', params: { prompt: 'a fox' } });

    expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/krea', {
      input: expect.objectContaining({ acceleration: 'high' }),
    });
  });

  it('sends a fetched endpoint only the fields its schema declares', async () => {
    const fetchMock = stubInputSchema('someone/prompt-only', { prompt: { type: 'string' } });

    await instance.createImage({ model: 'someone/prompt-only', params: { prompt: 'a fox' } });

    expect(mockFal.subscribe).toHaveBeenCalledWith('someone/prompt-only', {
      input: { prompt: 'a fox' },
    });
    expect((fetchMock.mock.calls[0] as unknown as [URL])[0].searchParams.get('endpoint_id')).toBe(
      'someone/prompt-only',
    );
  });

  it('sends built-in cards their curated input without loading a schema', async () => {
    const fetchMock = stubInputSchema('fal-ai/flux/schnell', { prompt: { type: 'string' } });

    await instance.createImage({ model: 'fal-ai/flux/schnell', params: { prompt: 'a fox' } });

    expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/schnell', {
      input: { enable_safety_checker: false, num_images: 1, prompt: 'a fox' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a single `image` output', async () => {
    stubInputSchema('fal-ai/some-upscaler');

    mockFal.subscribe.mockResolvedValue({
      data: { image: { height: 512, url: 'https://example.com/one.png', width: 512 } },
      requestId: 'r',
    } as any);

    await expect(
      instance.createImage({ model: 'fal-ai/some-upscaler', params: { prompt: 'p' } }),
    ).resolves.toEqual({ height: 512, imageUrl: 'https://example.com/one.png', width: 512 });
  });
});

describe('LobeFalAI models', () => {
  const catalogModel = (
    endpointId: string,
    category: string,
    properties: Record<string, any>,
    metadata: Record<string, unknown> = {},
  ) => ({
    endpoint_id: endpointId,
    metadata: { category, display_name: `${endpointId} name`, ...metadata },
    openapi: buildFalOpenAPI(endpointId, properties),
  });

  // fal rejects pages above 10 models when OpenAPI schemas are expanded
  const rejectsLargePages = (url: URL) =>
    url.searchParams.get('expand') === 'openapi-3.0' && Number(url.searchParams.get('limit')) > 10
      ? new Response('{"error":{"type":"validation_error"}}', { status: 400 })
      : undefined;

  const stubCatalog = (pages: Record<string, any[]>) => {
    const fetchMock = vi.fn(async (url: URL) => {
      const rejected = rejectsLargePages(url);
      if (rejected) return rejected;
      const category = url.searchParams.get('category') ?? '';
      return new Response(
        JSON.stringify({ has_more: false, models: pages[category] ?? [], next_cursor: null }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('lists image and video endpoints of any owner with derived parameters', async () => {
    const fetchMock = stubCatalog({
      'image-to-video': [
        catalogModel('bytedance/seedance-2.5/image-to-video', 'image-to-video', {
          image_url: { type: 'string' },
          prompt: { type: 'string' },
        }),
        catalogModel('fal-ai/kling-video/v2.1/standard/image-to-video', 'image-to-video', {
          duration: { default: '5', enum: ['5', '10'], type: 'string' },
          image_url: { type: 'string' },
          prompt: { type: 'string' },
        }),
      ],
      'text-to-image': [
        catalogModel(
          'black-forest-labs/flux-2-pro',
          'text-to-image',
          {
            aspect_ratio: { default: '1:1', enum: ['1:1', '16:9'], type: 'string' },
            prompt: { type: 'string' },
          },
          { date: '2026-05-01T10:00:00Z', description: ' Flux 2 ' },
        ),
        // Built-in cards keep their curated parameters, so the catalog copy is skipped
        catalogModel('fal-ai/flux/schnell', 'text-to-image', { prompt: { type: 'string' } }),
        // Task endpoints a built-in one-card family routes to are duplicates of that card
        catalogModel('fal-ai/bytedance/seedream/v4/edit', 'text-to-image', {
          prompt: { type: 'string' },
        }),
        // Upscalers and other prompt-less endpoints cannot be driven by the generation page
        catalogModel('fal-ai/upscaler', 'text-to-image', { image_url: { type: 'string' } }),
        catalogModel(
          'fal-ai/flux-lora-trainer',
          'text-to-image',
          { prompt: { type: 'string' } },
          { kind: 'training' },
        ),
      ],
    });

    const models = await instance.models();

    expect(models).toEqual([
      {
        description: 'Flux 2',
        displayName: 'black-forest-labs/flux-2-pro name',
        enabled: false,
        id: 'black-forest-labs/flux-2-pro',
        parameters: {
          aspectRatio: { default: '1:1', enum: ['1:1', '16:9'] },
          prompt: { default: '' },
        },
        releasedAt: '2026-05-01',
        type: 'image',
      },
      {
        description: undefined,
        displayName: 'fal-ai/kling-video/v2.1/standard/image-to-video name',
        enabled: false,
        id: 'fal-ai/kling-video/v2.1/standard/image-to-video',
        parameters: {
          duration: { default: 5, enum: [5, 10] },
          imageUrl: { default: null },
          prompt: { default: '' },
        },
        type: 'video',
      },
    ]);

    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('expand')).toBe('openapi-3.0');
    expect(url.searchParams.get('status')).toBe('active');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Key test-api-key' },
    });
  });

  it('follows the catalog cursor', async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      const rejected = rejectsLargePages(url);
      if (rejected) return rejected;
      const category = url.searchParams.get('category');
      if (category !== 'text-to-image') {
        return new Response(JSON.stringify({ has_more: false, models: [] }));
      }
      const cursor = url.searchParams.get('cursor');
      const model = catalogModel(cursor ? 'b/second' : 'a/first', 'text-to-image', {
        prompt: { type: 'string' },
      });
      return new Response(
        JSON.stringify({
          has_more: !cursor,
          models: [model],
          next_cursor: cursor ? null : 'page-2',
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const models = await instance.models();

    expect(models.map((model) => model.id)).toEqual(['a/first', 'b/second']);
  });

  it('retries rate-limited pages and keeps listed pages when a later page fails', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        const rejected = rejectsLargePages(url);
        if (rejected) return rejected;
        const category = url.searchParams.get('category');
        const cursor = url.searchParams.get('cursor');
        calls.push(`${category}:${cursor ?? 'first'}`);
        if (category === 'text-to-image') {
          if (!cursor) {
            return new Response(
              JSON.stringify({
                has_more: true,
                models: [catalogModel('a/first', 'text-to-image', { prompt: { type: 'string' } })],
                next_cursor: 'page-2',
              }),
            );
          }
          // The second page keeps failing: the first page must survive
          return new Response('{}', { status: 500 });
        }
        if (
          category === 'text-to-video' &&
          calls.filter((c) => c.startsWith('text-to-video')).length === 1
        ) {
          return new Response('{}', { headers: { 'retry-after': '0' }, status: 429 });
        }
        return new Response(
          JSON.stringify({
            has_more: false,
            models:
              category === 'text-to-video'
                ? [catalogModel('b/video', 'text-to-video', { prompt: { type: 'string' } })]
                : [],
          }),
        );
      }),
    );

    const models = await instance.models();

    expect(models.map((model) => model.id)).toEqual(['a/first', 'b/video']);
    expect(calls.filter((call) => call.startsWith('text-to-video'))).toHaveLength(2);
  });

  it('throws InvalidProviderAPIKey when every catalog request is unauthorized', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );

    await expect(instance.models()).rejects.toMatchObject({
      errorType: 'InvalidProviderAPIKey',
    });
  });
});

describe('getFalInputSchema', () => {
  it('refetches a cached schema once it expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const fetchMock = stubInputSchema('a/app', { prompt: { type: 'string' } });

    await getFalInputSchema('key', 'a/app');
    await getFalInputSchema('key', 'a/app');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000 + FAL_INPUT_SCHEMA_TTL_MS + 1);
    await getFalInputSchema('key', 'a/app');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
