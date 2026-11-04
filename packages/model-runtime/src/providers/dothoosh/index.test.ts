// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeChatCost } from '../../core/usageConverters/utils/computeChatCost';
import {
  clearDotHooshCatalogCache,
  DOTHOOSH_CATALOG_ENTRY_LIMIT,
  getDotHooshCatalog,
  resolveCatalogUrls,
} from './catalog';
import anthropicFixture from './fixtures/anthropic-models.json';
import openAIFixture from './fixtures/openai-models.json';
import { LobeDotHooshAI, params, resolveAnthropicBaseURL } from './index';

interface ResolvedRouter {
  apiType: string;
  models?: string[];
  options: {
    baseURL?: string;
    chatCompletion?: { useResponseModels?: Array<string | RegExp> };
    generateObject?: { useResponseModels?: Array<string | RegExp> };
    sdkType?: string;
  };
}

const MIRROR_V1 = 'https://www.dothoosh.com/gateway/v1/models';
const MIRROR_ANTHROPIC = 'https://www.dothoosh.com/gateway/anthropic/v1/models';

const stubCatalog = (
  openai: unknown = openAIFixture,
  anthropic: unknown = anthropicFixture,
  anthropicStatus = 200,
) => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/anthropic/v1/models')) {
      return anthropicStatus === 200
        ? new Response(JSON.stringify(anthropic), { status: 200 })
        : new Response('nope', { status: anthropicStatus });
    }
    return new Response(JSON.stringify(openai), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const resolveRouters = async (options: { baseURL?: string } = {}, model?: string) =>
  (await params.routers({ apiKey: 'test', ...options }, { model })) as ResolvedRouter[];

beforeEach(() => clearDotHooshCatalogCache());
afterEach(() => vi.unstubAllGlobals());

describe('resolveAnthropicBaseURL', () => {
  it('replaces a trailing /v1 with /anthropic', () => {
    expect(resolveAnthropicBaseURL('https://gateway.dothoosh.com/v1')).toBe(
      'https://gateway.dothoosh.com/anthropic',
    );
  });

  it('tolerates a trailing slash after /v1', () => {
    expect(resolveAnthropicBaseURL('https://proxy.example.com/v1/')).toBe(
      'https://proxy.example.com/anthropic',
    );
  });

  it('appends /anthropic to a base URL without /v1', () => {
    expect(resolveAnthropicBaseURL('https://proxy.example.com/')).toBe(
      'https://proxy.example.com/anthropic',
    );
  });
});

describe('resolveCatalogUrls', () => {
  it('uses the mirror for a keyless read of the default endpoint', () => {
    expect(resolveCatalogUrls({})).toEqual({ anthropic: MIRROR_ANTHROPIC, openai: MIRROR_V1 });
  });

  it('uses the configured base URL for a keyed read', () => {
    expect(resolveCatalogUrls({ apiKey: 'k', baseURL: 'https://proxy.example.com/v1' })).toEqual({
      anthropic: 'https://proxy.example.com/anthropic/v1/models',
      openai: 'https://proxy.example.com/v1/models',
    });
  });

  it('uses the default Iran-hosted endpoint for a keyed read without a custom URL', () => {
    expect(resolveCatalogUrls({ apiKey: 'k' })).toEqual({
      anthropic: 'https://gateway.dothoosh.com/anthropic/v1/models',
      openai: 'https://gateway.dothoosh.com/v1/models',
    });
  });
});

// The router createRouterRuntime picks: the first router listing the model, else the last one.
const matched = (routers: ResolvedRouter[], model: string) =>
  routers.find((router) => router.models?.includes(model)) ?? routers.at(-1)!;

describe('DotHoosh routers', () => {
  const find = (routers: ResolvedRouter[], apiType: string, responses = false) =>
    routers.find(
      (item) =>
        item.apiType === apiType &&
        Boolean(item.options.chatCompletion?.useResponseModels) === responses,
    );

  it('routes exactly the ids of the Anthropic listing to the Anthropic runtime', async () => {
    stubCatalog();
    const router = find(await resolveRouters(), 'anthropic');

    // dual-model is also served on Chat Completions, so it is not Anthropic-only
    expect(router?.models).toEqual(['claude-opus-5']);
    expect(router?.options.baseURL).toBe('https://gateway.dothoosh.com/anthropic');
  });

  it('sends a model listed on both routes (chat and anthropic-messages) to Chat Completions', async () => {
    stubCatalog();
    const routers = await resolveRouters({}, 'dual-model');

    expect(find(routers, 'anthropic')?.models).not.toContain('dual-model');
    expect(matched(routers, 'dual-model').apiType).toBe('openai');
    expect(
      matched(routers, 'dual-model').options.chatCompletion?.useResponseModels,
    ).toBeUndefined();
  });

  it('routes a new vendor id listed on the Anthropic route with no code change', async () => {
    stubCatalog(openAIFixture, {
      data: [{ id: 'acme-9-ultra', supported_parameters: [], type: 'model' }],
    });
    const router = find(await resolveRouters({}, 'acme-9-ultra'), 'anthropic');

    expect(router?.models).toEqual(['acme-9-ultra']);
  });

  it('routes a Claude-named id that is not on the Anthropic listing to Chat Completions', async () => {
    stubCatalog(openAIFixture, { data: [] });
    const routers = await resolveRouters({}, 'claude-ghost-1');

    expect(find(routers, 'anthropic')?.models).toEqual([]);
    expect(routers.at(-1)?.models).toBeUndefined();
  });

  it('routes every model whose protocols offer the Responses API to the Responses API', async () => {
    stubCatalog();
    const router = find(await resolveRouters(), 'openai', true);
    const patterns = router?.options.chatCompletion?.useResponseModels as RegExp[];

    expect(router?.models).toEqual(['gpt-5', 'kimi-k3']);
    expect(patterns.some((pattern) => pattern.test('kimi-k3'))).toBe(true);
    // anchored: a longer id that merely contains it stays on Chat Completions
    expect(patterns.some((pattern) => pattern.test('kimi-k3-mini'))).toBe(false);
    expect(router?.options.generateObject?.useResponseModels).toEqual(patterns);
    expect(router?.options.baseURL).toBe('https://gateway.dothoosh.com/v1');
  });

  it('prefers the Responses API for a model that offers both chat and responses', async () => {
    stubCatalog();
    const routers = await resolveRouters({}, 'gpt-5');

    expect(matched(routers, 'gpt-5').options.chatCompletion?.useResponseModels).toBeDefined();
    expect(find(routers, 'openai', true)?.models).toContain('gpt-5');
  });

  it('derives the Anthropic base URL from a custom OpenAI-compatible base URL', async () => {
    stubCatalog();
    const router = find(
      await resolveRouters({ baseURL: 'https://proxy.example.com/v1' }),
      'anthropic',
    );

    expect(router?.options.baseURL).toBe('https://proxy.example.com/anthropic');
  });

  it('routes the requested DeepSeek id to the deepseek runtime', async () => {
    stubCatalog();
    const router = (await resolveRouters({}, 'deepseek-flash')).find(
      (item) => item.apiType === 'deepseek',
    );

    expect(router?.models).toContain('deepseek-flash');
    expect(router?.options.sdkType).toBe('openai');
  });

  it('keeps the OpenAI-compatible catch-all last for everything else', async () => {
    stubCatalog();
    const last = (await resolveRouters({}, 'gemini-3-pro')).at(-1);

    expect(last?.apiType).toBe('openai');
    expect(last?.models).toBeUndefined();
    expect(last?.options.baseURL).toBe('https://gateway.dothoosh.com/v1');
  });

  it('fails closed for a chat when the catalog cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );

    await expect(resolveRouters({}, 'anything')).rejects.toThrow();
  });

  it('fetches the catalog once for repeated routing', async () => {
    const fetchMock = stubCatalog();
    await resolveRouters();
    await resolveRouters({}, 'kimi-k3');

    expect(fetchMock).toHaveBeenCalledTimes(2); // one OpenAI + one Anthropic listing
  });
});

describe('DotHoosh live model list', () => {
  afterEach(() => vi.unstubAllGlobals());

  const run = async (opts: {
    anthropic?: unknown;
    anthropicStatus?: number;
    openai?: unknown;
    options?: { apiKey?: string; baseURL?: string };
  }) => {
    const fetchMock = stubCatalog(
      opts.openai ?? { data: [] },
      opts.anthropic ?? { data: [] },
      opts.anthropicStatus,
    );
    const cards = await (params.models as any)({ client: {}, options: opts.options ?? {} });
    return { cards: new Map<string, any>(cards.map((card: any) => [card.id, card])), fetchMock };
  };
  const price = (card: any, name: string) =>
    card.pricing?.units.find((unit: any) => unit.name === name);

  it('merges the OpenAI and Anthropic listings', async () => {
    const { cards } = await run({ anthropic: anthropicFixture, openai: openAIFixture });

    expect(cards.has('gpt-5')).toBe(true);
    expect(cards.has('claude-opus-5')).toBe(true);
    // dual-model is on both listings: one card
    expect([...cards.keys()].filter((id) => id === 'dual-model')).toHaveLength(1);
  });

  it('keyed: reads both listings from the user base URL with the key', async () => {
    const { fetchMock } = await run({
      anthropic: anthropicFixture,
      openai: openAIFixture,
      options: { apiKey: 'k', baseURL: 'https://proxy.example.com/v1' },
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const openai = calls.find(([url]) => url === 'https://proxy.example.com/v1/models');
    const anthropic = calls.find(
      ([url]) => url === 'https://proxy.example.com/anthropic/v1/models',
    );
    expect((openai?.[1].headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect((anthropic?.[1].headers as Record<string, string>)['x-api-key']).toBe('k');
  });

  it('keyless: reads both listings from the mirror without credentials', async () => {
    const { fetchMock } = await run({ anthropic: anthropicFixture, openai: openAIFixture });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url).sort()).toEqual([MIRROR_ANTHROPIC, MIRROR_V1].sort());
    for (const [, init] of calls) {
      expect(JSON.stringify(init.headers)).not.toMatch(/Bearer|x-api-key/);
    }
  });

  it('converts per-token prices to USD per million tokens', async () => {
    const { cards } = await run({ openai: openAIFixture });
    const card = cards.get('gpt-5');

    expect(price(card, 'textOutput')).toBeDefined();
    expect(price(card, 'textInput_cacheRead')).toMatchObject({ rate: 0.125, strategy: 'fixed' });
    expect(price(card, 'textInput_cacheWrite')).toBeUndefined();
  });

  it('turns pricing_tiers into tiered units that only move where the price changes', async () => {
    const { cards } = await run({ openai: openAIFixture });
    const card = cards.get('gpt-5');

    expect(price(card, 'textInput')).toMatchObject({
      strategy: 'tiered',
      tiers: [
        { rate: 1.25, upTo: 128_000 },
        { rate: 2, upTo: 272_000 },
        { rate: 2.5, upTo: 'infinity' },
      ],
    });
    expect(price(card, 'textOutput')).toMatchObject({
      strategy: 'tiered',
      tiers: [
        { rate: 10, upTo: 272_000 },
        { rate: 15, upTo: 'infinity' },
      ],
    });
    expect(price(card, 'textInput_cacheRead').strategy).toBe('fixed');
  });

  it('maps limits, tools, reasoning and modalities from the listing', async () => {
    const { cards } = await run({ openai: openAIFixture });

    expect(cards.get('deepseek-v4')).toMatchObject({
      contextWindowTokens: 128_000,
      functionCall: true,
      maxOutput: 16_000,
      reasoning: true,
      vision: false,
    });
    expect(cards.get('gemini-3-pro')).toMatchObject({ functionCall: false, vision: true });
    expect(cards.get('kimi-k3')?.reasoning).toBe(false);
  });

  it('omits pricing when the listing has none', async () => {
    const { cards } = await run({ openai: openAIFixture });

    expect(cards.get('kimi-k3')?.pricing).toBeUndefined();
  });

  it('maps the Anthropic list shape (display_name, created_at, top_provider)', async () => {
    const { cards } = await run({ anthropic: anthropicFixture });
    const card = cards.get('claude-opus-5');

    expect(card).toMatchObject({
      contextWindowTokens: 200_000,
      displayName: 'claude-opus-5',
      functionCall: true,
      maxOutput: 25_000,
      reasoning: true,
      releasedAt: '2023-11-14',
      vision: true,
    });
    expect(card.settings.extendParams).toContain('opus47Effort');
  });

  it('keeps OpenAI-route models when the Claude fetch fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cards } = await run({ anthropicStatus: 503, openai: openAIFixture });

    expect(cards.has('gpt-5')).toBe(true);
    expect(cards.has('claude-opus-5')).toBe(false);
    spy.mockRestore();
  });

  it('refuses an empty OpenAI listing instead of returning an empty model list', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubCatalog({ data: [] }, { data: [] });

    await expect((params.models as any)({ client: {}, options: {} })).rejects.toThrow();
    spy.mockRestore();
  });

  it('does not grant vision, files, video or search from a vendor-named id', async () => {
    const { cards } = await run({
      openai: { data: [{ id: 'gemini-9-pro-vision', supported_parameters: ['tools'] }] },
    });
    const card = cards.get('gemini-9-pro-vision');

    expect(card.vision).toBe(false);
    expect(card.files).toBeFalsy();
    expect(card.video).toBe(false);
    expect(card.search).toBe(false);
  });
});

describe('DotHoosh listing resilience and limit precedence', () => {
  afterEach(() => vi.unstubAllGlobals());

  const call = async (options: { apiKey?: string; baseURL?: string } = {}) => {
    const cards = await (params.models as any)({ client: {}, options });
    return new Map<string, any>(cards.map((card: any) => [card.id, card]));
  };

  // One stubbed gateway whose two listings can be swapped between calls.
  const gateway = (state: { anthropic: () => Response; openai: () => Response }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/anthropic/v1/models') ? state.anthropic() : state.openai(),
      ),
    );
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const good = () => ({
    anthropic: () => json(anthropicFixture),
    openai: () => json(openAIFixture),
  });

  beforeEach(() => {
    clearDotHooshCatalogCache();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe('input-token tier boundary', () => {
    // pricing_tiers[].above_input_tokens is exclusive: exactly N tokens bills at the lower tier.
    const inputRateAt = async (inputTokens: number) => {
      const card = (await call()).get('gpt-5');
      const result = computeChatCost(card.pricing, {
        inputTextTokens: inputTokens,
        totalInputTokens: inputTokens,
      } as any);
      return result?.breakdown.find((item) => item.unit.name === 'textInput')?.segments?.[0]?.rate;
    };

    beforeEach(() => gateway(good()));

    it('bills N-1 and N input tokens at the lower tier', async () => {
      expect(await inputRateAt(127_999)).toBe(1.25);
      expect(await inputRateAt(128_000)).toBe(1.25);
    });

    it('bills N+1 input tokens at the higher tier', async () => {
      expect(await inputRateAt(128_001)).toBe(2);
      expect(await inputRateAt(272_001)).toBe(2.5);
    });
  });

  describe.each([
    ['an error envelope', () => json({ error: { message: 'upstream down' } })],
    ['an empty data list', () => json({ data: [] })],
    ['a data field that is not a list', () => json({ data: 'oops' })],
    ['entries without ids', () => json({ data: [{ name: 'x' }, null, 42] })],
    ['a body that is not JSON', () => new Response('<html>502</html>', { status: 200 })],
    ['a null body', () => json(null)],
    ['a 503', () => new Response('nope', { status: 503 })],
  ])('after a good fetch, when the OpenAI listing returns %s', (_name, bad) => {
    it('keeps the previous OpenAI models and the live Claude models', async () => {
      gateway(good());
      const before = await call();

      gateway({ ...good(), openai: bad });
      const after = await call();

      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      expect(after.get('gpt-5')).toEqual(before.get('gpt-5'));
      expect(console.warn).toHaveBeenCalled();
    });

    it('does not make Claude models leave the Anthropic route', async () => {
      gateway(good());
      await call();

      gateway({ ...good(), openai: bad });
      const routers = await resolveRouters();

      expect(routers[0].models).toContain('claude-opus-5');
    });
  });

  describe.each([
    ['an error envelope', () => json({ error: { message: 'upstream down' } })],
    ['an empty data list', () => json({ data: [] })],
    ['a body that is not JSON', () => new Response('<html>502</html>', { status: 200 })],
    ['a 503', () => new Response('nope', { status: 503 })],
  ])('after a good fetch, when the Anthropic listing returns %s', (_name, bad) => {
    it('keeps the previous Claude models and the live OpenAI models', async () => {
      gateway(good());
      const before = await call();

      gateway({ ...good(), anthropic: bad });
      const after = await call();

      expect(after.has('claude-opus-5')).toBe(true);
      expect(after.get('claude-opus-5')).toEqual(before.get('claude-opus-5'));
      expect(after.has('gpt-5')).toBe(true);
    });

    it('keeps Claude on the Anthropic route', async () => {
      gateway(good());
      await call();

      gateway({ ...good(), anthropic: bad });
      const routers = await resolveRouters();

      expect(routers[0].models).toContain('claude-opus-5');
    });
  });

  it('picks up a shrunk but valid listing (a model really removed)', async () => {
    gateway(good());
    await call();

    gateway({ ...good(), openai: () => json({ data: [{ id: 'only-model' }] }) });
    const after = await call();

    expect(after.has('only-model')).toBe(true);
    expect(after.has('gpt-5')).toBe(false);
  });

  it('refuses a first-ever malformed OpenAI listing rather than returning no models', async () => {
    gateway({ ...good(), openai: () => json({ error: { message: 'x' } }) });

    await expect(call()).rejects.toThrow();
  });

  it('serves OpenAI models without Claude when the first Anthropic listing is malformed', async () => {
    gateway({ ...good(), anthropic: () => json({ error: { message: 'x' } }) });
    const cards = await call();

    expect(cards.has('gpt-5')).toBe(true);
    expect(cards.has('claude-opus-5')).toBe(false);
  });

  it('keeps previous listings per endpoint and key', async () => {
    gateway(good());
    await call({ apiKey: 'a', baseURL: 'https://one.example.com/v1' });

    gateway({ ...good(), openai: () => json({ error: 'x' }) });
    await expect(call({ apiKey: 'b', baseURL: 'https://two.example.com/v1' })).rejects.toThrow();
  });

  describe('live limits and prices win over the vendor card the id resolves to', () => {
    const listed = {
      id: 'gpt-5',
      context_length: 123_456,
      pricing: { completion: '0.000002', prompt: '0.000001' },
      supported_parameters: ['tools'],
      top_provider: { context_length: 123_456, max_completion_tokens: 4321 },
    };

    it('uses the listed context window, output cap and prices', async () => {
      gateway({ ...good(), openai: () => json({ data: [listed] }) });
      const card = (await call()).get('gpt-5');

      expect(card.contextWindowTokens).toBe(123_456);
      expect(card.maxOutput).toBe(4321);
      expect(card.pricing.units.find((u: any) => u.name === 'textInput').rate).toBe(1);
      expect(card.pricing.units.find((u: any) => u.name === 'textOutput').rate).toBe(2);
    });

    it('never borrows a vendor price when the listing carries none', async () => {
      gateway({
        ...good(),
        openai: () => json({ data: [{ id: 'gpt-5', context_length: 123_456 }] }),
      });
      const card = (await call()).get('gpt-5');

      expect(card.pricing).toBeUndefined();
      expect(card.contextWindowTokens).toBe(123_456);
    });
  });
});

describe('DotHoosh fail-closed routing and bounded catalog caches', () => {
  // Keys whose requests fail with a 500, per listing.
  const down: Record<'anthropic' | 'openai', Set<string>> = {
    anthropic: new Set(),
    openai: new Set(),
  };
  const served = {
    anthropic: { data: [{ id: 'claude-sonnet-5-5', supported_parameters: [], type: 'model' }] },
    openai: {
      data: [
        { id: 'deepseek-v4-pro', supported_parameters: ['tools'] },
        { id: 'gpt-6-responses-only', protocols: [{ protocol: 'openai-responses' }] },
      ],
    },
  };
  // Every non-listing request (inference) is recorded here and answered with an empty stream.
  const upstream: string[] = [];
  const fetchCalls = () => vi.mocked(globalThis.fetch).mock.calls.length;

  const stubGateway = () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!/\/models$/.test(url)) {
          upstream.push(url);
          return new Response('data: [DONE]\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          });
        }
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const listing = url.endsWith('/anthropic/v1/models') ? 'anthropic' : 'openai';
        const key =
          listing === 'openai'
            ? headers.Authorization?.replace(/^Bearer /, '')
            : headers['x-api-key'];
        if (key && down[listing].has(key)) return new Response('nope', { status: 500 });
        return new Response(JSON.stringify(served[listing]), { status: 200 });
      }),
    );
  };

  const route = async (model?: string) =>
    (await params.routers({ apiKey: 'k1' }, { model })) as ResolvedRouter[];

  beforeEach(() => {
    for (const keys of Object.values(down)) keys.clear();
    upstream.length = 0;
    stubGateway();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('routing a chat whose route is unknown', () => {
    it('rejects when the OpenAI listing is down on a cold start', async () => {
      down.openai.add('k1');

      await expect(route('claude-sonnet-5-5')).rejects.toThrow();
    });

    it('rejects a Claude model when the Anthropic listing is down and the id is not on the OpenAI listing', async () => {
      down.anthropic.add('k1');

      await expect(route('claude-sonnet-5-5')).rejects.toThrow('Anthropic model list');
    });

    it('routes a model listed on the OpenAI listing while the Anthropic listing is down', async () => {
      down.anthropic.add('k1');
      const routers = await route('deepseek-v4-pro');

      expect(routers).toHaveLength(4);
      expect(routers[0].models).toEqual([]);
    });

    it('routes a Responses-only model listed on the OpenAI listing while the Anthropic listing is down', async () => {
      down.anthropic.add('k1');
      const routers = await route('gpt-6-responses-only');

      expect(routers[1].models).toContain('gpt-6-responses-only');
    });

    it('resolves without a model when both listings are down and logs the failure once', async () => {
      down.openai.add('k1');
      down.anthropic.add('k1');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const routers = (await params.routers({ apiKey: 'k1' })) as ResolvedRouter[];

      expect(routers[0].models).toEqual([]);
      expect(routers[1].models).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe('[DotHoosh] Failed to load the catalog for routing:');
    });

    it('rejects a model when both listings are down on a cold start', async () => {
      down.openai.add('k1');
      down.anthropic.add('k1');

      await expect(route('deepseek-v4-pro')).rejects.toThrow();
    });

    it('routes a Claude model from the previous copy when the Anthropic listing fails later', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
      await route('claude-sonnet-5-5');

      down.anthropic.add('k1');
      vi.setSystemTime(new Date('2026-10-24T08:06:00Z'));
      const routers = await route('claude-sonnet-5-5');

      expect(routers[0].models).toContain('claude-sonnet-5-5');
    });

    it('treats a malformed Anthropic listing as a failure, unlike a well-formed empty one', async () => {
      stubCatalog(openAIFixture, { error: { message: 'unavailable' } });

      await expect(resolveRouters({}, 'claude-sonnet-5-5')).rejects.toThrow('Anthropic model list');
    });

    describe('end to end', () => {
      beforeAll(() => import('../../core/RouterRuntime/baseRuntimeMap'), 120_000);

      it('sends no chat request when the route of the model is unknown', async () => {
        down.openai.add('k1');
        const runtime = new LobeDotHooshAI({ apiKey: 'k1' });

        const outcome = await runtime
          .chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-sonnet-5-5',
            temperature: 1,
          })
          .then(
            (response) => ({ failed: response.status >= 400 }),
            () => ({ failed: true }),
          );

        expect(outcome.failed).toBe(true);
        expect(upstream).toEqual([]);
      });
    });
  });

  describe('bounded catalog caches', () => {
    it('evicts the least recently written catalog entry beyond the limit', async () => {
      expect(DOTHOOSH_CATALOG_ENTRY_LIMIT).toBe(100);
      for (let i = 0; i <= DOTHOOSH_CATALOG_ENTRY_LIMIT; i++) {
        await getDotHooshCatalog({ apiKey: `key-${i}` });
      }
      const afterFill = fetchCalls();

      await getDotHooshCatalog({ apiKey: 'key-0' });
      expect(fetchCalls()).toBeGreaterThan(afterFill);

      const afterEvicted = fetchCalls();
      await getDotHooshCatalog({ apiKey: `key-${DOTHOOSH_CATALOG_ENTRY_LIMIT}` });
      expect(fetchCalls()).toBe(afterEvicted);
    });

    it('refreshes recency on a cache hit before evicting', async () => {
      expect(DOTHOOSH_CATALOG_ENTRY_LIMIT).toBe(100);
      const limit = DOTHOOSH_CATALOG_ENTRY_LIMIT;
      await getDotHooshCatalog({ apiKey: 'key-0' });
      for (let i = 1; i < limit; i++) await getDotHooshCatalog({ apiKey: `key-${i}` });
      await getDotHooshCatalog({ apiKey: 'key-0' });

      const before = fetchCalls();
      await getDotHooshCatalog({ apiKey: 'key-new' });
      expect(fetchCalls()).toBe(before + 2);

      await getDotHooshCatalog({ apiKey: 'key-0' });
      expect(fetchCalls()).toBe(before + 2);

      await getDotHooshCatalog({ apiKey: 'key-1' });
      expect(fetchCalls()).toBe(before + 4);
    });

    it('drops expired entries before evicting live ones', async () => {
      expect(DOTHOOSH_CATALOG_ENTRY_LIMIT).toBe(100);
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.parse('2026-10-24T08:00:00Z');
      const limit = DOTHOOSH_CATALOG_ENTRY_LIMIT;
      vi.setSystemTime(start);
      for (let i = 1; i < limit; i++) await getDotHooshCatalog({ apiKey: `key-${i}` });

      vi.setSystemTime(start + 60_000);
      down.anthropic.add('key-deg');
      await getDotHooshCatalog({ apiKey: 'key-deg' });

      vi.setSystemTime(start + 120_000);
      await getDotHooshCatalog({ apiKey: 'key-new' });

      const before = fetchCalls();
      await getDotHooshCatalog({ apiKey: 'key-1' });
      expect(fetchCalls()).toBe(before);
    });

    it('forgets the last good listing of the least recently written key beyond the limit', async () => {
      expect(DOTHOOSH_CATALOG_ENTRY_LIMIT).toBe(100);
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.parse('2026-10-24T08:00:00Z');
      vi.setSystemTime(start);
      await getDotHooshCatalog({ apiKey: 'key-0' });
      for (let i = 1; i <= DOTHOOSH_CATALOG_ENTRY_LIMIT; i++) {
        await getDotHooshCatalog({ apiKey: `key-${i}` });
      }

      vi.setSystemTime(start + 6 * 60_000);
      down.openai.add('key-0');
      await expect(getDotHooshCatalog({ apiKey: 'key-0' })).rejects.toThrow();
    });

    it('keeps the last good listing of a key while few other keys were seen', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.parse('2026-10-24T08:00:00Z');
      vi.setSystemTime(start);
      await getDotHooshCatalog({ apiKey: 'key-0' });
      for (let i = 1; i <= 3; i++) await getDotHooshCatalog({ apiKey: `key-${i}` });

      vi.setSystemTime(start + 6 * 60_000);
      down.openai.add('key-0');
      const catalog = await getDotHooshCatalog({ apiKey: 'key-0' });

      expect(catalog.openai.map((model) => model.id)).toEqual([
        'deepseek-v4-pro',
        'gpt-6-responses-only',
      ]);
    });
  });
});
