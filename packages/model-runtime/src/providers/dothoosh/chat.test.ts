// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeChatCost } from '../../core/usageConverters/utils/computeChatCost';
import { clearDotHooshCatalogCache } from './catalog';
import anthropicFixture from './fixtures/live-anthropic-models.json';
import openAIFixture from './fixtures/live-openai-models.json';
import { LobeDotHooshAI } from './index';
import { parseDotHooshModels } from './parseModels';

const loadModelsMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

interface Recorded {
  body: Record<string, unknown>;
  headers: Headers;
  url: string;
}

const BASE_URL = 'https://proxy.example.com/v1';
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const ANTHROPIC_STREAM = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[],"usage":{"input_tokens":1,"output_tokens":0}}}',
  'event: message_stop\ndata: {"type":"message_stop"}',
  '',
].join('\n\n');

// Serves the live listings, records every inference request and answers it with an empty stream.
const stubGateway = () => {
  const requests: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === 'GET') {
        return json(
          request.url.endsWith('/anthropic/v1/models') ? anthropicFixture : openAIFixture,
        );
      }
      requests.push({
        body: await request.clone().json(),
        headers: request.headers,
        url: request.url,
      });
      const stream = request.url.endsWith('/messages') ? ANTHROPIC_STREAM : 'data: [DONE]\n\n';
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  return requests;
};

const chatWith = async (model: string) => {
  const requests = stubGateway();
  const runtime = new LobeDotHooshAI({ apiKey: 'dh-test-key', baseURL: BASE_URL });
  await runtime.chat({ messages: [{ content: 'Hello', role: 'user' }], model, temperature: 0 });
  return requests;
};

// The router loads every SDK runtime lazily on first use, which is slow on a cold, busy machine.
beforeAll(() => import('../../core/RouterRuntime/baseRuntimeMap'), 120_000);
beforeEach(() => {
  clearDotHooshCatalogCache();
  loadModelsMock.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe('DotHoosh chat requests reach the API the listing assigns', () => {
  it('sends a Claude model to the Anthropic Messages API under the derived base URL', async () => {
    const [request] = await chatWith('claude-sonnet-5-5');

    expect(request.url).toBe('https://proxy.example.com/anthropic/v1/messages');
    expect(request.headers.get('x-api-key')).toBe('dh-test-key');
    expect(request.body.model).toBe('claude-sonnet-5-5');
  });

  it.each(['gpt-6-astra', 'gpt-6.1-sol'])(
    'sends %s to the Responses API, where its function tools work',
    async (model) => {
      const [request] = await chatWith(model);

      expect(request.url).toBe(`${BASE_URL}/responses`);
      expect(request.headers.get('authorization')).toBe('Bearer dh-test-key');
      expect(request.body.model).toBe(model);
    },
  );

  it.each(['gemini-4-argon', 'kimi-k3'])('sends %s to Chat Completions', async (model) => {
    const [request] = await chatWith(model);

    expect(request.url).toBe(`${BASE_URL}/chat/completions`);
    expect(request.headers.get('authorization')).toBe('Bearer dh-test-key');
    expect(request.body.model).toBe(model);
  });

  it.each(['deepseek-flash', 'deepseek-v4-pro'])(
    'sends %s, listed on both routes, to Chat Completions and never to the Anthropic route',
    async (model) => {
      const [request] = await chatWith(model);

      expect(request.url).toBe(`${BASE_URL}/chat/completions`);
      expect(request.body.model).toBe(model);
    },
  );

  it('sends the API key only to the configured base URL', async () => {
    const requests = await chatWith('gemini-4-argon');
    const fetchMock = vi.mocked(globalThis.fetch);

    for (const [input] of fetchMock.mock.calls) {
      expect(String(input instanceof Request ? input.url : input)).toMatch(
        /^https:\/\/proxy\.example\.com\//,
      );
    }
    expect(requests).toHaveLength(1);
  });
});

describe('DotHoosh model fetching through the runtime', () => {
  it('lists the models of both listings with the live limits, from the configured base URL', async () => {
    stubGateway();
    const runtime = new LobeDotHooshAI({ apiKey: 'dh-test-key', baseURL: BASE_URL });

    const models = await runtime.models();
    const ids = models.map((model) => model.id);

    expect(ids).toEqual(expect.arrayContaining(['claude-sonnet-5-5', 'gpt-6-astra', 'kimi-k3']));
    expect(new Set(ids).size).toBe(ids.length);
    const calls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${BASE_URL}/models`,
        'https://proxy.example.com/anthropic/v1/models',
      ]),
    );
  });
});

describe('DotHoosh chat usage cost', () => {
  const RESPONSES_STREAM = [
    'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}',
    'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":1000,"output_tokens":500,"total_tokens":1500}}}',
    '',
  ].join('\n\n');

  it('prices a Responses API chat from the live catalog, not from another provider card with the same id', async () => {
    // The bank prices gpt-6-astra under OpenAI at a different rate than the gateway lists.
    const bankPricing = {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };
    loadModelsMock.mockResolvedValue([
      { id: 'gpt-6-astra', pricing: bankPricing, providerId: 'openai' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method === 'GET') {
          return json(
            request.url.endsWith('/anthropic/v1/models') ? anthropicFixture : openAIFixture,
          );
        }
        return new Response(RESPONSES_STREAM, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    // No baseURL: the chat goes to DotHoosh's own endpoint, the only source of trusted prices.
    const runtime = new LobeDotHooshAI({ apiKey: 'dh-test-key' });

    const response = await runtime.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-6-astra',
      temperature: 0,
    });
    const body = await response.text();

    const usageFrame = /event: usage\ndata: (.+)/.exec(body);
    expect(usageFrame, body).not.toBeNull();
    const { cost, ...usage } = JSON.parse(usageFrame![1]);
    const livePricing = (
      await parseDotHooshModels({
        anthropic: anthropicFixture.data,
        openai: openAIFixture.data,
      } as any)
    ).find((card) => card.id === 'gpt-6-astra')!.pricing;
    const expected = computeChatCost(livePricing as any, usage)?.totalCost;
    const fromBank = computeChatCost(bankPricing as any, usage)?.totalCost;

    expect(expected).toBeGreaterThan(0);
    expect(cost).toBe(expected);
    expect(cost).not.toBe(fromBank);
  });
});
