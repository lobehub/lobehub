// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDotHooshCatalogCache } from './catalog';
import liveAnthropic from './fixtures/live-anthropic-models.json';
import liveOpenAI from './fixtures/live-openai-models.json';
import { params } from './index';

// The fixtures are the real `GET /gateway/v1/models` and `/gateway/anthropic/v1/models`
// payloads (policy blocks removed), so these tests run the mapping against the live shape.

interface ResolvedRouter {
  apiType: string;
  models?: string[];
  options: {
    baseURL?: string;
    chatCompletion?: { useResponseModels?: Array<string | RegExp> };
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Gateway {
  anthropic: () => Response;
  openai: () => Response;
}
const live = (): Gateway => ({
  anthropic: () => json(liveAnthropic),
  openai: () => json(liveOpenAI),
});

const gateway = (state: Gateway) => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith('/anthropic/v1/models') ? state.anthropic() : state.openai(),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const routers = async (options: { apiKey?: string; baseURL?: string } = {}, model?: string) =>
  (await params.routers({ apiKey: 'test', ...options }, { model })) as ResolvedRouter[];

// The router createRouterRuntime picks: the first router listing the model, else the last one.
const matched = (list: ResolvedRouter[], model: string) =>
  list.find((router) => router.models?.includes(model)) ?? list.at(-1)!;

const cardsOf = async (options: { apiKey?: string; baseURL?: string } = {}) => {
  const cards = await (params.models as any)({ client: {}, options });
  return new Map<string, any>(cards.map((card: any) => [card.id, card]));
};
const unit = (card: any, name: string) => card.pricing?.units.find((u: any) => u.name === name);

beforeEach(() => {
  clearDotHooshCatalogCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DotHoosh routing against the live listings', () => {
  it('sends the Claude ids to the Anthropic runtime and nothing else', async () => {
    gateway(live());
    const anthropic = (await routers()).find((router) => router.apiType === 'anthropic');

    expect(anthropic?.models).toEqual([
      'claude-fable-5-1',
      'claude-haiku-5-5',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ]);
  });

  it.each(['deepseek-flash', 'deepseek-v4-pro'])(
    'sends %s, listed on both routes, to the deepseek runtime over Chat Completions',
    async (id) => {
      gateway(live());
      const router = matched(await routers({}, id), id);

      expect(router.apiType).toBe('deepseek');
      expect(router.options.baseURL).toBe('https://gateway.dothoosh.com/v1');
    },
  );

  it.each(['gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol'])(
    'sends %s, which offers the Responses API, to the Responses API',
    async (id) => {
      gateway(live());
      const router = matched(await routers({}, id), id);
      const patterns = router.options.chatCompletion?.useResponseModels as RegExp[];

      expect(router.apiType).toBe('openai');
      expect(patterns.some((pattern) => pattern.test(id))).toBe(true);
    },
  );

  it.each(['gemini-4-argon', 'kimi-k3', 'kimi-k2.6'])(
    'keeps %s on Chat Completions',
    async (id) => {
      gateway(live());
      const router = matched(await routers({}, id), id);

      expect(router.apiType).toBe('openai');
      expect(router.options.chatCompletion?.useResponseModels).toBeUndefined();
    },
  );
});

describe('DotHoosh prices keep their precision', () => {
  it('converts the live per-token prices without dropping digits', async () => {
    gateway(live());
    const cards = await cardsOf();

    const flash = cards.get('deepseek-flash');
    expect(unit(flash, 'textInput').rate).toBe(0.385_001);
    expect(unit(flash, 'textInput_cacheRead').rate).toBe(0.007_701);
    expect(unit(flash, 'textOutput').rate).toBe(1.54);

    const haiku = cards.get('claude-haiku-5-5');
    expect(unit(haiku, 'textInput').tiers[0].rate).toBe(0.128_336);
    expect(unit(haiku, 'textInput').tiers[1].rate).toBe(0.641_67);
    expect(unit(haiku, 'textInput_cacheWrite').tiers[0].rate).toBe(0.160_42);
  });
});

describe('DotHoosh cards only carry what the listing says', () => {
  it('does not inherit settings from the vendor card the id resolves to', async () => {
    gateway(live());
    const cards = await cardsOf();

    for (const [id, card] of cards) {
      const settings = card.settings ?? {};
      expect(
        Object.keys(settings).filter((key) => key !== 'extendParams' && key !== 'disabledParams'),
        id,
      ).toEqual([]);
      const extend: string[] = settings.extendParams ?? [];
      const allowed = id.startsWith('claude-')
        ? ['opus47Effort']
        : id.startsWith('gpt-6')
          ? ['gpt6ReasoningEffort']
          : [];
      expect(extend, id).toEqual(allowed);
    }
  });
});

describe('DotHoosh catalog caching and failure handling', () => {
  it('does not keep serving a catalog that was built while the Anthropic listing was down', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const state = { ...live(), anthropic: () => new Response('down', { status: 503 }) };
    gateway(state);
    expect((await routers()).find((router) => router.apiType === 'anthropic')?.models).toEqual([]);

    state.anthropic = () => json(liveAnthropic);
    vi.setSystemTime(Date.now() + 11_000);

    expect((await routers()).find((router) => router.apiType === 'anthropic')?.models).toContain(
      'claude-opus-5-5',
    );
  });

  it('still caches a complete catalog for repeated routing', async () => {
    const fetchMock = gateway(live());
    await routers();
    await routers({}, 'kimi-k3');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives every listing request a timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = gateway(live());
    await cardsOf();

    expect(timeout).toHaveBeenCalledWith(10_000);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('warns when only Anthropic-route models are left', async () => {
    gateway({ ...live(), openai: () => json({ data: [] }) });
    const cards = await cardsOf({ apiKey: 'k' });

    expect(
      [...cards.keys()].every((id) => id.startsWith('claude-') || id.startsWith('deepseek-')),
    ).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('only Anthropic-route models'),
    );
  });
});

describe('a key with a model allow-list can legitimately see an empty route', () => {
  const key = { apiKey: 'k', baseURL: 'https://proxy.example.com/v1' };

  it('accepts a well-formed empty OpenAI listing for a keyed fetch', async () => {
    gateway({ ...live(), openai: () => json({ data: [] }) });
    const cards = await cardsOf(key);

    expect(cards.has('claude-opus-5-5')).toBe(true);
    expect(cards.has('gpt-6-luna')).toBe(false);
  });

  it('accepts a well-formed empty Anthropic listing for a keyed fetch', async () => {
    gateway({ ...live(), anthropic: () => json({ data: [] }) });
    const cards = await cardsOf(key);

    expect(cards.has('gpt-6-luna')).toBe(true);
    expect(cards.has('claude-opus-5-5')).toBe(false);
  });

  it('follows a keyed key whose allow-list shrinks instead of keeping the old models', async () => {
    gateway(live());
    await cardsOf(key);

    gateway({ ...live(), openai: () => json({ data: [] }) });
    const cards = await cardsOf(key);

    expect(cards.has('gpt-6-luna')).toBe(false);
  });

  it('keeps the last good catalog when a keyed fetch returns two empty listings', async () => {
    gateway(live());
    const before = await cardsOf(key);

    gateway({ anthropic: () => json({ data: [] }), openai: () => json({ data: [] }) });
    const after = await cardsOf(key);

    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it('rejects a first-ever keyed fetch when both listings are empty', async () => {
    gateway({ anthropic: () => json({ data: [] }), openai: () => json({ data: [] }) });

    await expect(cardsOf(key)).rejects.toThrow();
  });

  it('keeps the last good catalog when a keyed listing yields no usable rows', async () => {
    gateway(live());
    const before = await cardsOf(key);

    gateway({ ...live(), openai: () => json({ data: [{ name: 'x' }, null, 42] }) });
    const after = await cardsOf(key);

    expect(after.has('gpt-6-luna')).toBe(true);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it('still refuses an empty route for the keyless public listing', async () => {
    gateway(live());
    const before = await cardsOf();

    gateway({ ...live(), openai: () => json({ data: [] }) });
    const after = await cardsOf();

    expect(after.has('gpt-6-luna')).toBe(true);
    expect(after.size).toBe(before.size);
  });

  it('does not hand one key the last good catalog of another key on the same endpoint', async () => {
    gateway(live());
    await cardsOf({ apiKey: 'key-a', baseURL: key.baseURL });

    gateway({ ...live(), openai: () => json({ error: { message: 'bad key' } }) });

    await expect(cardsOf({ apiKey: 'key-b', baseURL: key.baseURL })).rejects.toThrow();
  });
});
