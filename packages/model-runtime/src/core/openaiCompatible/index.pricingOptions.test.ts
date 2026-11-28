// @vitest-environment node
import { loadModels } from '@lobechat/business-model-bank/model-config';
import aihubmixModels from 'model-bank/aihubmix';
import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAICompatibleRuntime } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../utils/model', () => ({
  getModelPricing: vi.fn().mockResolvedValue({}),
}));

afterEach(() => vi.clearAllMocks());

describe('getPricingOptions hook', () => {
  it('should resolve pricing options from the transformed chat request payload', async () => {
    const create = vi.fn().mockRejectedValue(new Error('stop after hook'));
    const getPricingOptions = vi.fn(() => ({ lookupParams: { ttl: '1h' } }));
    const Runtime = createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      chatCompletion: { getPricingOptions },
      customClient: {
        createClient: () => ({ chat: { completions: { create } } }) as unknown as OpenAI,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({ apiKey: 'test' });

    await runtime
      .chat({ messages: [{ content: 'hi', role: 'user' }], model: 'test-model', stream: true })
      .catch(() => {});

    expect(getPricingOptions).toHaveBeenCalledTimes(1);
    // The second argument must be the final provider request: stream_options
    // only exists on the transmitted payload, never on the intermediate one.
    expect(getPricingOptions).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model' }),
      expect.objectContaining({
        model: 'test-model',
        stream_options: { include_usage: true },
      }),
    );
  });

  it('should resolve pricing options on the custom stream client branch', async () => {
    const createChatCompletionStream = vi.fn(() => {
      throw new Error('stop after hook');
    });
    const getPricingOptions = vi.fn(() => ({ lookupParams: { ttl: '1h' } }));
    const Runtime = createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      chatCompletion: { getPricingOptions },
      customClient: {
        createChatCompletionStream: createChatCompletionStream as any,
        createClient: () => ({ chat: { completions: { create: vi.fn() } } }) as unknown as OpenAI,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({
      apiKey: 'test',
      modelIdMapping: { 'logical-model': 'upstream-model' },
    });

    await runtime
      .chat({ messages: [{ content: 'hi', role: 'user' }], model: 'logical-model', stream: true })
      .catch(() => {});

    expect(getPricingOptions).toHaveBeenCalledTimes(1);
    // The mapped upstream id only exists on the final provider request.
    expect(getPricingOptions).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'logical-model' }),
      expect.objectContaining({ model: 'upstream-model' }),
    );
  });

  it('should price lookup units through the hook on the custom stream client', async () => {
    const usageChunk = {
      choices: [],
      created: 1_785_670_001,
      id: 'chatcmpl_custom_hook',
      model: 'claude-opus-4-6',
      object: 'chat.completion.chunk',
      usage: {
        completion_tokens: 10,
        prompt_tokens: 1_000_000,
        prompt_tokens_details: { cache_write_tokens: 1_000_000, cached_tokens: 0 },
        total_tokens: 1_000_010,
      },
    };
    const createChatCompletionStream = vi.fn(
      () =>
        ({
          async *[Symbol.asyncIterator]() {
            yield usageChunk;
          },
        }) as any,
    );
    const Runtime = createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      chatCompletion: { getPricingOptions: () => ({ lookupParams: { ttl: '1h' } }) },
      customClient: {
        createChatCompletionStream: createChatCompletionStream as any,
        createClient: () => ({ chat: { completions: { create: vi.fn() } } }) as unknown as OpenAI,
      },
      provider: 'aihubmix',
    });
    const runtime = new Runtime({ apiKey: 'test' });
    const cards = aihubmixModels.map((m) => ({ ...m, providerId: 'aihubmix' }));
    vi.mocked(loadModels).mockResolvedValue(cards as any);
    try {
      const response = await runtime.chat({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'claude-opus-4-6',
        stream: true,
      });
      const text = await response.text();
      const costs = [...text.matchAll(/"cost":([\d.]+)/g)].map((m) => Number(m[1]));
      // 1M cache-write tokens at the 1h lookup rate ($10/M) dominate the cost.
      expect(Math.max(...costs, 0)).toBeGreaterThan(9);
    } finally {
      vi.mocked(loadModels).mockResolvedValue([]);
    }
  });

  it('should resolve pricing options for the Responses API flow', async () => {
    const rawStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          response: { id: 'resp_hook', model: 'test-model', status: 'in_progress', usage: null },
          sequence_number: 0,
          type: 'response.created',
        };
      },
    };
    const create = vi.fn(() => ({
      withResponse: vi.fn().mockResolvedValue({
        data: rawStream,
        request_id: 'req_hook',
        response: new Response('', { headers: {}, status: 200 }),
      }),
    }));
    const getPricingOptions = vi.fn(() => ({ lookupParams: { ttl: '1h' } }));
    const Runtime = createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      chatCompletion: { getPricingOptions, useResponse: true },
      customClient: {
        createClient: () => ({ responses: { create } }) as unknown as OpenAI,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({ apiKey: 'test' });

    const response = await runtime.chat({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'test-model',
      stream: true,
    });
    await response.text().catch(() => {});

    expect(getPricingOptions).toHaveBeenCalledTimes(1);
    // `store` is only set on the prepared Responses request, never on the
    // LobeHub payload.
    expect(getPricingOptions).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model' }),
      expect.objectContaining({ model: 'test-model', store: false }),
    );
  });

  it('should price lookup units through the forwarded options end to end', async () => {
    const usageChunk = {
      choices: [],
      created: 1_785_670_001,
      id: 'chatcmpl_hook',
      model: 'claude-opus-4-6',
      object: 'chat.completion.chunk',
      usage: {
        completion_tokens: 10,
        prompt_tokens: 1_000_000,
        prompt_tokens_details: { cache_write_tokens: 1_000_000, cached_tokens: 0 },
        total_tokens: 1_000_010,
      },
    };
    const runChat = async (withHook: boolean) => {
      const rawStream = {
        async *[Symbol.asyncIterator]() {
          yield usageChunk;
        },
      };
      const create = vi.fn(() => ({
        withResponse: vi.fn().mockResolvedValue({
          data: rawStream,
          request_id: 'req_hook_e2e',
          response: new Response('', { headers: {}, status: 200 }),
        }),
      }));
      const Runtime = createOpenAICompatibleRuntime({
        baseURL: 'https://api.test.com/v1',
        chatCompletion: withHook
          ? { getPricingOptions: () => ({ lookupParams: { ttl: '1h' } }) }
          : {},
        customClient: {
          createClient: () => ({ chat: { completions: { create } } }) as unknown as OpenAI,
        },
        provider: 'aihubmix',
      });
      const runtime = new Runtime({ apiKey: 'test' });
      const response = await runtime.chat({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'claude-opus-4-6',
        stream: true,
      });
      const text = await response.text();
      const costs = [...text.matchAll(/"cost":([\d.]+)/g)].map((m) => Number(m[1]));
      return Math.max(...costs, 0);
    };

    // The file-level mock pins loadModels to []; feed it the real aihubmix
    // cards so getModelPricing can resolve the lookup-priced claude card.
    const cards = aihubmixModels.map((m) => ({ ...m, providerId: 'aihubmix' }));
    vi.mocked(loadModels).mockResolvedValue(cards as any);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let costWithoutHook: number;
    let costWithHook: number;
    try {
      costWithoutHook = await runChat(false);
      costWithHook = await runChat(true);
    } finally {
      warn.mockRestore();
      vi.mocked(loadModels).mockResolvedValue([]);
    }

    // The aihubmix claude-opus-4-6 card prices cache writes via a ttl-keyed
    // lookup, so the 1M write tokens only bill when the hook supplies the ttl.
    expect(costWithoutHook).toBeGreaterThan(0); // output tokens still priced
    expect(costWithHook).toBeGreaterThan(costWithoutHook);
  });

  it('should price lookup units through the forwarded options on the Responses flow', async () => {
    const runChat = async (withHook: boolean) => {
      const rawEvents = [
        {
          response: {
            id: 'resp_hook_e2e',
            model: 'claude-opus-4-6',
            status: 'in_progress',
            usage: null,
          },
          sequence_number: 0,
          type: 'response.created',
        },
        {
          response: {
            id: 'resp_hook_e2e',
            model: 'claude-opus-4-6',
            output: [],
            status: 'completed',
            usage: {
              input_tokens: 1_000_000,
              input_tokens_details: { cache_write_tokens: 1_000_000, cached_tokens: 0 },
              output_tokens: 10,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 1_000_010,
            },
          },
          sequence_number: 1,
          type: 'response.completed',
        },
      ] as unknown as OpenAI.Responses.ResponseStreamEvent[];
      const rawStream = {
        async *[Symbol.asyncIterator]() {
          for (const event of rawEvents) yield event;
        },
      };
      const create = vi.fn(() => ({
        withResponse: vi.fn().mockResolvedValue({
          data: rawStream,
          request_id: 'req_hook_responses',
          response: new Response('', { headers: {}, status: 200 }),
        }),
      }));
      const Runtime = createOpenAICompatibleRuntime({
        baseURL: 'https://api.test.com/v1',
        chatCompletion: withHook
          ? { getPricingOptions: () => ({ lookupParams: { ttl: '1h' } }), useResponse: true }
          : { useResponse: true },
        customClient: {
          createClient: () => ({ responses: { create } }) as unknown as OpenAI,
        },
        provider: 'aihubmix',
      });
      const runtime = new Runtime({ apiKey: 'test' });
      const response = await runtime.chat({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'claude-opus-4-6',
        stream: true,
      });
      const text = await response.text();
      const costs = [...text.matchAll(/"cost":([\d.]+)/g)].map((m) => Number(m[1]));
      return Math.max(...costs, 0);
    };

    const cards = aihubmixModels.map((m) => ({ ...m, providerId: 'aihubmix' }));
    vi.mocked(loadModels).mockResolvedValue(cards as any);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let costWithoutHook: number;
    let costWithHook: number;
    try {
      costWithoutHook = await runChat(false);
      costWithHook = await runChat(true);
    } finally {
      warn.mockRestore();
      vi.mocked(loadModels).mockResolvedValue([]);
    }

    expect(costWithoutHook).toBeGreaterThan(0);
    expect(costWithHook).toBeGreaterThan(costWithoutHook);
  });
});
