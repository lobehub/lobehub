// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPricing } from '../../utils/getModelPricing';
import { clearDotHooshCatalogCache, getDotHooshCatalog } from './catalog';
import anthropicFixture from './fixtures/live-anthropic-models.json';
import openAIFixture from './fixtures/live-openai-models.json';
// Importing the runtime module registers the DotHoosh pricing resolver.
import { params } from './index';
import { parseDotHooshModels } from './parseModels';

// The model bank prices the same ids under other providers, at rates that differ from the gateway's.
const loadModelsMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const bankCard = (id: string, providerId: string, rate: number) => ({
  id,
  pricing: { units: [{ name: 'textInput', rate, strategy: 'fixed', unit: 'millionTokens' }] },
  providerId,
});

const KEY = { apiKey: 'k1' };

interface Listing {
  data: Array<Record<string, any>>;
}

const stubGateway = (
  openai: unknown = openAIFixture,
  anthropic: unknown = anthropicFixture,
  statuses: { anthropic?: number; openai?: number } = {},
) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const isAnthropic = url.endsWith('/anthropic/v1/models');
      const status = (isAnthropic ? statuses.anthropic : statuses.openai) ?? 200;
      if (status !== 200) return new Response('unavailable', { status });
      return new Response(JSON.stringify(isAnthropic ? anthropic : openai), { status: 200 });
    }),
  );
};

interface Endpoint {
  anthropic?: unknown;
  anthropicStatus?: number;
  openai?: unknown;
  openaiStatus?: number;
}

const EMPTY_LISTING = { data: [] };
const MIRROR_HOST = 'www.dothoosh.com';
const DEFAULT_HOST = 'gateway.dothoosh.com';
const CUSTOM_HOST = 'proxy.example.com';
const CUSTOM_BASE_URL = `https://${CUSTOM_HOST}/v1`;

// Answers each listing by host, so the mirror, the default endpoint and a custom endpoint can differ.
const stubEndpoints = (endpoints: Record<string, Endpoint>) => {
  const fetchMock = vi.fn(async (url: string) => {
    const endpoint = endpoints[new URL(url).hostname];
    if (!endpoint) return new Response('not stubbed', { status: 404 });
    const isAnthropic = url.endsWith('/anthropic/v1/models');
    const status = (isAnthropic ? endpoint.anthropicStatus : endpoint.openaiStatus) ?? 200;
    if (status !== 200) return new Response('unavailable', { status });
    const body = (isAnthropic ? endpoint.anthropic : endpoint.openai) ?? EMPTY_LISTING;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const pricedCard = (id: string, prompt: string, completion = '0.00001') => ({
  id,
  pricing: { completion, prompt },
  protocols: [{ protocol: 'openai-chat-completions' }],
});

const listingOf = (...cards: Array<Record<string, any>>): Listing => ({ data: cards });

const T0 = new Date('2026-10-25T10:00:00Z').getTime();
const MINUTE = 60_000;

const liveRate = async (id = 'gpt-6-astra') =>
  textInput(await getModelPricing(id, 'dothoosh'))?.rate;

const liveCards = async (openai: unknown = openAIFixture, anthropic: unknown = anthropicFixture) =>
  new Map(
    (
      await parseDotHooshModels({
        anthropic: (anthropic as Listing).data,
        openai: (openai as Listing).data,
      } as any)
    ).map((card) => [card.id, card]),
  );

const withPrompt = (listing: Listing, id: string, prompt: string): Listing => {
  const copy = structuredClone(listing);
  const entry = copy.data.find((item) => item.id === id)!;
  entry.pricing = { ...entry.pricing, prompt };
  return copy;
};

const textInput = (pricing: any) => pricing?.units.find((unit: any) => unit.name === 'textInput');

beforeEach(() => {
  clearDotHooshCatalogCache();
  loadModelsMock.mockResolvedValue([
    bankCard('gpt-6-astra', 'openai', 1),
    bankCard('gpt-4o', 'openai', 2.5),
    bankCard('claude-sonnet-5-5', 'anthropic', 3),
    bankCard('deepseek-v4-pro', 'deepseek', 0.5),
    bankCard('unpriced-model', 'moonshot', 4),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DotHoosh usage pricing comes from the live catalog', () => {
  it('prices a listed model with the pricing its card carries, not another provider card', async () => {
    stubGateway();
    await getDotHooshCatalog(KEY);

    const pricing = await getModelPricing('gpt-6-astra', 'dothoosh');

    expect(pricing).toEqual((await liveCards()).get('gpt-6-astra')!.pricing);
    expect(pricing).toBeDefined();
    expect(pricing).not.toEqual(await getModelPricing('gpt-6-astra', 'openai'));
  });

  it('gives no price to an id the live catalog does not list, even when the bank prices it elsewhere', async () => {
    stubGateway();
    await getDotHooshCatalog(KEY);

    await expect(getModelPricing('gpt-4o', 'dothoosh')).resolves.toBeUndefined();
  });

  it('prices a Claude id served only on the Anthropic listing from that listing', async () => {
    stubGateway();
    await getDotHooshCatalog(KEY);

    const pricing = await getModelPricing('claude-sonnet-5-5', 'dothoosh');

    expect(pricing).toEqual((await liveCards()).get('claude-sonnet-5-5')!.pricing);
    expect(textInput(pricing).rate).toBe(2.566667);
  });

  it('prices a model on both listings with the OpenAI listing rate', async () => {
    const anthropic = withPrompt(anthropicFixture as Listing, 'deepseek-v4-pro', '0.000009');
    stubGateway(openAIFixture, anthropic);
    await getDotHooshCatalog(KEY);

    const pricing = await getModelPricing('deepseek-v4-pro', 'dothoosh');

    expect(textInput(pricing).rate).toBe(1.694002);
    expect(pricing).toEqual(
      (await liveCards(openAIFixture, anthropic)).get('deepseek-v4-pro')!.pricing,
    );
  });

  it('gives no price to a listed model whose card carries none', async () => {
    const openai = structuredClone(openAIFixture) as Listing;
    openai.data.push({
      id: 'unpriced-model',
      protocols: [{ protocol: 'openai-chat-completions' }],
    });
    stubGateway(openai);
    await getDotHooshCatalog(KEY);

    await expect(getModelPricing('unpriced-model', 'dothoosh')).resolves.toBeUndefined();
    await expect(getModelPricing('gpt-6-astra', 'dothoosh')).resolves.toBeDefined();
  });

  it('gives no price before any catalog is loaded and after the cache is cleared', async () => {
    await expect(getModelPricing('gpt-6-astra', 'dothoosh')).resolves.toBeUndefined();

    stubGateway();
    await getDotHooshCatalog(KEY);
    await expect(getModelPricing('gpt-6-astra', 'dothoosh')).resolves.toBeDefined();

    clearDotHooshCatalogCache();
    await expect(getModelPricing('gpt-6-astra', 'dothoosh')).resolves.toBeUndefined();
  });

  it('never lets a degraded listing write prices, told apart from a re-read of the previous copy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    // k1's previous copy will hold A (2), while the shared index is last written by the mirror with B (3).
    stubEndpoints({
      [DEFAULT_HOST]: { openai: listingOf(pricedCard('gpt-6-astra', '0.000002')) },
      [MIRROR_HOST]: { openai: listingOf(pricedCard('gpt-6-astra', '0.000003')) },
    });
    await getDotHooshCatalog({ apiKey: 'k1' });
    await getDotHooshCatalog({});
    expect(await liveRate()).toBe(3);

    // The cache expires and k1's OpenAI listing fails: its previous copy (A) is served, degraded.
    vi.setSystemTime(T0 + 6 * MINUTE);
    stubEndpoints({ [DEFAULT_HOST]: { openaiStatus: 500 } });
    await expect(getDotHooshCatalog({ apiKey: 'k1' })).resolves.toBeDefined();
    expect(await liveRate()).toBe(3);

    // After the short degraded TTL, a live listing with a new price (C) replaces it.
    vi.setSystemTime(T0 + 6 * MINUTE + 11_000);
    stubEndpoints({
      [DEFAULT_HOST]: { openai: listingOf(pricedCard('gpt-6-astra', '0.000004')) },
    });
    await getDotHooshCatalog({ apiKey: 'k1' });
    expect(await liveRate()).toBe(4);
  });

  it('keeps the live price index bounded, dropping the least recently written ids first', async () => {
    const openai: Listing = {
      data: Array.from({ length: 1100 }, (_, index) => ({
        id: `bulk-model-${index}`,
        pricing: { completion: '0.000002', prompt: '0.000001' },
        protocols: [{ protocol: 'openai-chat-completions' }],
      })),
    };
    stubGateway(openai, { data: [] });
    await getDotHooshCatalog(KEY);

    await expect(getModelPricing('bulk-model-0', 'dothoosh')).resolves.toBeUndefined();
    await expect(getModelPricing('bulk-model-1099', 'dothoosh')).resolves.toBeDefined();
  });

  it("does not let a user-supplied endpoint change anyone's price or evict the index", async () => {
    const junk = Array.from({ length: 1500 }, (_, index) =>
      pricedCard(`junk-${index}`, '0.000001', '0.000001'),
    );
    const defaultEndpoint = { openai: listingOf(pricedCard('gpt-6-astra', '0.000002')) };
    stubEndpoints({
      [CUSTOM_HOST]: { openai: listingOf(pricedCard('gpt-6-astra', '0', '0'), ...junk) },
      [DEFAULT_HOST]: defaultEndpoint,
    });
    await getDotHooshCatalog({ apiKey: 'k1' });
    const priceA = await getModelPricing('gpt-6-astra', 'dothoosh');
    expect(textInput(priceA).rate).toBe(2);

    await getDotHooshCatalog({ apiKey: 'k2', baseURL: CUSTOM_BASE_URL });
    await getDotHooshCatalog({ baseURL: CUSTOM_BASE_URL });

    expect(await getModelPricing('gpt-6-astra', 'dothoosh')).toEqual(priceA);
    expect(await liveRate()).toBe(2);
    await expect(getModelPricing('junk-0', 'dothoosh')).resolves.toBeUndefined();
    await expect(getModelPricing('junk-1499', 'dothoosh')).resolves.toBeUndefined();

    // The real chat path: routing through the custom endpoint once its cache expired.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * MINUTE);
    stubEndpoints({
      [CUSTOM_HOST]: { openai: listingOf(pricedCard('gpt-6-astra', '0.000007'), ...junk) },
      [DEFAULT_HOST]: defaultEndpoint,
    });
    await params.routers({ apiKey: 'k2', baseURL: CUSTOM_BASE_URL }, { model: 'gpt-6-astra' });

    expect(await getModelPricing('gpt-6-astra', 'dothoosh')).toEqual(priceA);
    expect(await liveRate()).toBe(2);
    await expect(getModelPricing('junk-0', 'dothoosh')).resolves.toBeUndefined();
    await expect(getModelPricing('junk-1499', 'dothoosh')).resolves.toBeUndefined();
  });

  it('never prices from a custom endpoint alone, and the resolver makes no request', async () => {
    const fetchMock = stubEndpoints({
      [CUSTOM_HOST]: { openai: listingOf(pricedCard('gpt-6-astra', '0.000009')) },
    });
    await getDotHooshCatalog({ apiKey: 'k2', baseURL: CUSTOM_BASE_URL });
    const callsBefore = fetchMock.mock.calls.length;

    await expect(getModelPricing('gpt-6-astra', 'dothoosh')).resolves.toBeUndefined();

    expect(fetchMock.mock.calls).toHaveLength(callsBefore);
    const hosts = fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname);
    expect(hosts.length).toBeGreaterThan(0);
    expect(new Set(hosts)).toEqual(new Set([CUSTOM_HOST]));
  });

  it.each(['https://gateway.dothoosh.com/v1/', 'https://gateway.dothoosh.com/v1'])(
    'trusts an explicit base URL equal to the default endpoint (%s)',
    async (baseURL) => {
      stubEndpoints({
        [DEFAULT_HOST]: { openai: listingOf(pricedCard('gpt-6-astra', '0.000002')) },
      });

      await getDotHooshCatalog({ apiKey: 'k1', baseURL });

      expect(await liveRate()).toBe(2);
    },
  );

  it('keeps a model on both listings at the OpenAI price while the OpenAI listing is degraded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    stubEndpoints({
      [DEFAULT_HOST]: {
        anthropic: listingOf(pricedCard('deepseek-v4-pro', '0.000005')),
        openai: listingOf(pricedCard('deepseek-v4-pro', '0.000001')),
      },
    });
    await getDotHooshCatalog({ apiKey: 'k1' });
    expect(await liveRate('deepseek-v4-pro')).toBe(1);

    // The OpenAI listing fails (previous copy served, degraded) while the Anthropic one is live and
    // lists the same model at another price: the model is still routed, so priced, by the OpenAI one.
    vi.setSystemTime(T0 + 6 * MINUTE);
    stubEndpoints({
      [DEFAULT_HOST]: {
        anthropic: listingOf(pricedCard('deepseek-v4-pro', '0.000009')),
        openaiStatus: 500,
      },
    });
    await getDotHooshCatalog({ apiKey: 'k1' });

    expect(await liveRate('deepseek-v4-pro')).toBe(1);
  });
});
