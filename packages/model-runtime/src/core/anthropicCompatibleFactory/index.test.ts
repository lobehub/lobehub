// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatStreamPayload } from '../../types';
import type { ModelRuntimeDiagnostics } from '../../types/providerDiagnostics';
import { ContextExceededPreFlightError } from '../../utils/resolveSafeMaxTokens';
import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
  createDefaultAnthropicClient,
  DEFAULT_ANTHROPIC_TIMEOUT,
  handleDefaultAnthropicError,
  resolveDefaultAnthropicPricingOptions,
} from './index';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn();
  return { default: MockAnthropic };
});

vi.mock('@lobechat/const', () => ({
  CURRENT_VERSION: '1.0.0-test',
}));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const MockedAnthropic = vi.mocked(Anthropic);
const originalAnthropicClientTimeout = process.env.ANTHROPIC_CLIENT_TIMEOUT;

afterEach(() => {
  if (originalAnthropicClientTimeout === undefined) {
    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  } else {
    process.env.ANTHROPIC_CLIENT_TIMEOUT = originalAnthropicClientTimeout;
  }
});

describe('createDefaultAnthropicClient', () => {
  it('should include User-Agent header with current version', () => {
    MockedAnthropic.mockClear();

    createDefaultAnthropicClient({ apiKey: 'test-key' });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHeaders: expect.objectContaining({
          'User-Agent': 'lobehub/1.0.0-test',
        }),
      }),
    );
  });

  it('should preserve caller-provided default headers alongside User-Agent', () => {
    MockedAnthropic.mockClear();

    createDefaultAnthropicClient({
      apiKey: 'test-key',
      defaultHeaders: { 'X-Custom': 'value' },
    });

    const passedOptions = MockedAnthropic.mock.calls[0][0] as any;

    expect(passedOptions.defaultHeaders).toMatchObject({
      'User-Agent': 'lobehub/1.0.0-test',
      'X-Custom': 'value',
    });
  });

  it('should set the default Anthropic timeout explicitly', () => {
    MockedAnthropic.mockClear();
    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;

    createDefaultAnthropicClient({ apiKey: 'test-key' });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: DEFAULT_ANTHROPIC_TIMEOUT,
      }),
    );
  });

  it('should use ANTHROPIC_CLIENT_TIMEOUT as the default timeout when configured', () => {
    MockedAnthropic.mockClear();
    process.env.ANTHROPIC_CLIENT_TIMEOUT = '780000';

    createDefaultAnthropicClient({ apiKey: 'test-key' });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 780_000,
      }),
    );

    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  });

  it('should ignore invalid ANTHROPIC_CLIENT_TIMEOUT values', () => {
    MockedAnthropic.mockClear();
    process.env.ANTHROPIC_CLIENT_TIMEOUT = 'invalid';

    createDefaultAnthropicClient({ apiKey: 'test-key' });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: DEFAULT_ANTHROPIC_TIMEOUT,
      }),
    );

    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  });

  it('should preserve caller-provided timeout', () => {
    MockedAnthropic.mockClear();
    process.env.ANTHROPIC_CLIENT_TIMEOUT = '780000';

    createDefaultAnthropicClient({
      apiKey: 'test-key',
      timeout: 3_600_000,
    });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 3_600_000,
      }),
    );

    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  });

  it.each([
    ['https://aihubmix.com/v1', 'https://aihubmix.com'],
    ['https://aihubmix.com/v1/messages', 'https://aihubmix.com'],
    ['https://api.example.com/anthropic/v1', 'https://api.example.com/anthropic'],
    ['https://api.example.com/anthropic', 'https://api.example.com/anthropic'],
  ])('should normalize Anthropic SDK-managed baseURL path %s', (baseURL, expectedBaseURL) => {
    MockedAnthropic.mockClear();

    createDefaultAnthropicClient({ apiKey: 'test-key', baseURL });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expectedBaseURL,
      }),
    );
  });
});

describe('handleDefaultAnthropicError', () => {
  it('classifies upstream 413 as an oversized request body', () => {
    expect(
      handleDefaultAnthropicError(
        { message: 'Failed to buffer the request body: length limit exceeded', status: 413 },
        { apiKey: 'test-key', baseURL: 'https://api.example.com/anthropic' },
      ),
    ).toMatchObject({
      errorType: AgentRuntimeErrorType.RequestBodyTooLarge,
    });
  });

  it('should classify provider balance errors as insufficient quota', () => {
    expect(
      handleDefaultAnthropicError(
        {
          error: {
            error: {
              code: 'invalid_request_error',
              message: 'Insufficient Balance',
              type: 'unknown_error',
            },
          },
          status: 402,
        },
        { apiKey: 'test-key', baseURL: 'https://api.example.com/anthropic' },
      ),
    ).toMatchObject({
      error: {
        code: 'invalid_request_error',
        message: 'Insufficient Balance',
        type: 'unknown_error',
      },
      errorType: AgentRuntimeErrorType.InsufficientQuota,
    });
  });
});

describe('createAnthropicCompatibleRuntime', () => {
  it('returns a structured context error before dispatch when payload pre-flight fails', async () => {
    const messagesCreate = vi.fn();
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        handlePayload: () => {
          throw new ContextExceededPreFlightError({
            ctx: 1_048_576,
            minOutputTokens: 1024,
            model: 'deepseek-v4-flash',
            promptTokens: 1_200_000,
          });
        },
      },
      customClient: {
        createClient: () => ({ messages: { create: messagesCreate } }) as unknown as Anthropic,
      },
      provider: 'deepseek',
    });

    await expect(
      new Runtime({ apiKey: 'test-key' }).chat({ model: 'deepseek-v4-flash' } as any),
    ).rejects.toMatchObject({
      error: {
        ctx: 1_048_576,
        promptTokens: 1_200_000,
        type: 'context_exceeded_pre_flight',
      },
      errorType: AgentRuntimeErrorType.ExceededContextWindow,
    });
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it('classifies an upstream 413 response as an oversized request body', async () => {
    const messagesCreate = vi.fn().mockRejectedValue({
      message: '<html>413 Request Entity Too Large</html>',
      status: 413,
    });
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        handlePayload: (payload) => ({ max_tokens: 1024, messages: [], model: payload.model }),
      },
      customClient: {
        createClient: () => ({ messages: { create: messagesCreate } }) as unknown as Anthropic,
      },
      provider: 'deepseek',
    });

    await expect(
      new Runtime({ apiKey: 'test-key' }).chat({ model: 'deepseek-v4-flash' } as any),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.RequestBodyTooLarge });
  });

  it.each([
    [401, AgentRuntimeErrorType.InvalidGithubToken],
    [500, AgentRuntimeErrorType.OllamaBizError],
  ])('honors error type overrides for a %i response', async (status, expectedErrorType) => {
    const messagesCreate = vi.fn().mockRejectedValue({ message: 'upstream error', status });
    const Runtime = createAnthropicCompatibleRuntime(
      createAnthropicCompatibleParams({
        chatCompletion: {
          handlePayload: (payload) => ({ max_tokens: 1024, messages: [], model: payload.model }),
        },
        customClient: {
          createClient: () => ({ messages: { create: messagesCreate } }) as unknown as Anthropic,
        },
        errorType: {
          bizError: AgentRuntimeErrorType.OllamaBizError,
          invalidAPIKey: AgentRuntimeErrorType.InvalidGithubToken,
        },
        provider: 'test-provider',
      }),
    );

    await expect(
      new Runtime({ apiKey: 'test-key' }).chat({ model: 'test-model' } as any),
    ).rejects.toMatchObject({ errorType: expectedErrorType });
  });

  it('should normalize default baseURL before creating a custom client', () => {
    const createClient = vi.fn((options) => ({ baseURL: options.baseURL }) as unknown as Anthropic);
    const Runtime = createAnthropicCompatibleRuntime({
      baseURL: 'https://aihubmix.com/v1',
      customClient: { createClient },
      provider: 'test-provider',
    });

    const runtime = new Runtime({ apiKey: 'test-key' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://aihubmix.com',
        timeout: DEFAULT_ANTHROPIC_TIMEOUT,
      }),
    );
    expect(runtime.baseURL).toBe('https://aihubmix.com');
  });

  it('should send mapped model id to Anthropic Messages API', async () => {
    const messagesCreate = vi.fn().mockResolvedValue({ content: [] });
    const getPricingOptions = vi.fn(() => undefined);
    const handlePayload = vi.fn((payload) => ({
      max_tokens: 1024,
      messages: [],
      model: payload.model,
    }));
    const createClient = vi.fn((options) => ({
      baseURL: options.baseURL,
      messages: { create: messagesCreate },
    }));
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        getPricingOptions,
        handlePayload,
      },
      customClient: {
        createClient: (options) => createClient(options) as unknown as Anthropic,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({
      apiKey: 'test-key',
      modelIdMapping: { 'logical-model': 'upstream-model' },
    });

    await runtime.chat({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'logical-model',
      responseMode: 'json',
      stream: false,
    } as any);

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'upstream-model',
      }),
      expect.anything(),
    );
    expect(handlePayload).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'logical-model' }),
      expect.anything(),
    );
    expect(getPricingOptions).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'logical-model' }),
      expect.objectContaining({ model: 'logical-model' }),
    );
    expect(createClient.mock.calls[0][0]).not.toHaveProperty('modelIdMapping');
  });

  it('should classify provider balance errors without a custom error handler', async () => {
    const messagesCreate = vi.fn().mockRejectedValue({
      error: {
        error: {
          code: 'invalid_request_error',
          message: 'Insufficient Balance',
          type: 'unknown_error',
        },
      },
      status: 402,
    });
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        handlePayload: (payload) => ({
          max_tokens: 1024,
          messages: [],
          model: payload.model,
        }),
      },
      customClient: {
        createClient: () =>
          ({
            baseURL: 'https://api.example.com/anthropic',
            messages: { create: messagesCreate },
          }) as unknown as Anthropic,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({ apiKey: 'test-key' });

    await expect(
      runtime.chat({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'test-model',
        responseMode: 'json',
        stream: false,
      } as any),
    ).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.InsufficientQuota,
    });
  });

  it('should retain the exact provider request and raw streaming response diagnostics', async () => {
    const rawEvents = [
      {
        message: {
          content: [],
          id: 'msg_deepseek_empty',
          model: 'deepseek-v4-pro',
          role: 'assistant',
          stop_reason: null,
          stop_sequence: null,
          type: 'message',
          usage: { input_tokens: 206_384, output_tokens: 0 },
        },
        type: 'message_start',
      },
      {
        content_block: { signature: 'provider-signature', thinking: ' ', type: 'thinking' },
        index: 0,
        type: 'content_block_start',
      },
      { index: 0, type: 'content_block_stop' },
      {
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        type: 'message_delta',
        usage: { input_tokens: 206_384, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ] as unknown as Anthropic.MessageStreamEvent[];
    const rawResponseBody = rawEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
    const rawStream = {
      async *[Symbol.asyncIterator]() {
        for (const event of rawEvents) yield event;
      },
    };
    const messagesCreate = vi.fn(() => ({
      withResponse: vi.fn().mockResolvedValue({
        data: rawStream,
        request_id: 'req_deepseek_empty',
        response: new Response(rawResponseBody, {
          headers: {
            'cf-ray': 'ray-1',
            'content-type': 'text/event-stream',
            'x-request-id': 'req-header-1',
          },
          status: 200,
        }),
      }),
    }));
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        handlePayload: (payload) => ({
          max_tokens: 4096,
          messages: [{ content: 'Question', role: 'user' }],
          model: payload.model,
          thinking: { budget_tokens: 2048, type: 'enabled' },
        }),
      },
      customClient: {
        createClient: () =>
          ({
            baseURL: 'https://api.deepseek.com/anthropic',
            messages: { create: messagesCreate },
          }) as unknown as Anthropic,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/anthropic',
    });
    const diagnostics: ModelRuntimeDiagnostics = {};

    const response = await runtime.chat(
      {
        messages: [{ content: 'Question', role: 'user' }],
        model: 'deepseek-v4-pro',
        stream: true,
      },
      { diagnostics, user: 'user-1' },
    );
    await response.text();

    expect(diagnostics.providerRequest).toEqual(
      expect.objectContaining({
        apiMode: 'messages',
        endpoint: expect.stringMatching(/\/anthropic$/),
        payload: expect.objectContaining({
          max_tokens: 4096,
          messages: [{ content: 'Question', role: 'user' }],
          metadata: { user_id: 'user-1' },
          model: 'deepseek-v4-pro',
          stream: true,
        }),
        sentAt: expect.any(Number),
      }),
    );
    expect(diagnostics.providerResponse).toEqual(
      expect.objectContaining({
        completedAt: expect.any(Number),
        eventCount: 5,
        eventCounts: expect.objectContaining({
          'content_block_start:thinking': 1,
          'message_delta': 1,
          'message_stop': 1,
        }),
        firstEventAt: expect.any(Number),
        hasNonWhitespaceText: false,
        hasNonWhitespaceThinking: false,
        headers: {
          'cf-ray': 'ray-1',
          'content-type': 'text/event-stream',
          'x-request-id': 'req-header-1',
        },
        messageId: 'msg_deepseek_empty',
        model: 'deepseek-v4-pro',
        rawEvents,
        rawResponse: {
          body: rawResponseBody,
          byteLength: new TextEncoder().encode(rawResponseBody).byteLength,
          status: 'captured',
        },
        requestId: 'req_deepseek_empty',
        responseReceivedAt: expect.any(Number),
        signatureChars: 18,
        status: 200,
        stopReason: 'end_turn',
        terminalEventReceived: true,
        thinkingChars: 1,
        toolUseCount: 0,
        usage: { input_tokens: 206_384, output_tokens: 1 },
      }),
    );
  });

  it('should observe provider diagnostics from a custom ReadableStream response', async () => {
    const rawEvents = [
      {
        message: {
          content: [],
          id: 'msg_readable_stream',
          model: 'custom-model',
          role: 'assistant',
          stop_reason: null,
          stop_sequence: null,
          type: 'message',
          usage: { input_tokens: 12, output_tokens: 0 },
        },
        type: 'message_start',
      },
      {
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        type: 'message_delta',
        usage: { input_tokens: 12, output_tokens: 0 },
      },
      { type: 'message_stop' },
    ] as unknown as Anthropic.MessageStreamEvent[];
    const rawStream = new ReadableStream<Anthropic.MessageStreamEvent>({
      start(controller) {
        for (const event of rawEvents) controller.enqueue(event);
        controller.close();
      },
    });
    const messagesCreate = vi.fn(() => ({
      withResponse: vi.fn().mockResolvedValue({ data: rawStream }),
    }));
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        handlePayload: (payload) => ({
          max_tokens: 1024,
          messages: [{ content: 'Question', role: 'user' }],
          model: payload.model,
        }),
      },
      customClient: {
        createClient: () =>
          ({
            baseURL: 'https://example.com/anthropic',
            messages: { create: messagesCreate },
          }) as unknown as Anthropic,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({ apiKey: 'test-key' });
    const diagnostics: ModelRuntimeDiagnostics = {};

    const response = await runtime.chat(
      {
        messages: [{ content: 'Question', role: 'user' }],
        model: 'custom-model',
        stream: true,
      },
      { diagnostics },
    );
    await response.text();

    expect(diagnostics.providerResponse).toEqual(
      expect.objectContaining({
        completedAt: expect.any(Number),
        eventCount: 3,
        messageId: 'msg_readable_stream',
        rawEvents,
        stopReason: 'end_turn',
        terminalEventReceived: true,
      }),
    );
  });

  it('should strip trailing assistant prefill when a logical id maps to a Claude 5 model', async () => {
    // The prefill strip inside handlePayload sees the logical id; when the
    // mapping only later resolves to a Claude 4.6+/5 upstream id, chat() must
    // re-strip against the model actually sent.
    const messagesCreate = vi.fn().mockResolvedValue({ content: [] });
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        handlePayload: (payload) => ({
          max_tokens: 1024,
          messages: [
            { content: 'hi', role: 'user' },
            { content: '...', role: 'assistant' },
          ],
          model: payload.model,
        }),
      },
      customClient: {
        createClient: () =>
          ({
            baseURL: 'https://aihubmix.com',
            messages: { create: messagesCreate },
          }) as unknown as Anthropic,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({
      apiKey: 'test-key',
      modelIdMapping: { 'logical-model': 'claude-opus-5' },
    });

    await runtime.chat({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'logical-model',
      responseMode: 'json',
      stream: false,
    } as any);

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'claude-opus-5',
      }),
      expect.anything(),
    );
  });

  it('should keep logical model for generateObject and pass mapped id as request config', async () => {
    const generateObject = vi.fn().mockResolvedValue({ ok: true });
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        handlePayload: (payload) => ({
          max_tokens: 1024,
          messages: [],
          model: payload.model,
        }),
      },
      customClient: {
        createClient: () =>
          ({
            baseURL: 'https://aihubmix.com',
            messages: { create: vi.fn() },
          }) as unknown as Anthropic,
      },
      generateObject,
      provider: 'test-provider',
    });
    const runtime = new Runtime({
      apiKey: 'test-key',
      modelIdMapping: { 'logical-model': 'upstream-model' },
    });

    const result = await runtime.generateObject({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'logical-model',
      schema: {
        name: 'result',
        schema: { properties: {}, type: 'object' },
      },
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'logical-model' }),
      undefined,
      undefined,
      expect.objectContaining({ requestModel: 'upstream-model' }),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('buildDefaultAnthropicPayload cache ttl', () => {
  const requestPayload = (overrides: Partial<ChatStreamPayload> = {}): ChatStreamPayload => ({
    messages: [
      { content: 'You are a helpful assistant.', role: 'system' },
      { content: 'Hello', role: 'user' },
    ],
    model: 'claude-opus-5',
    temperature: 1,
    ...overrides,
  });

  it('keeps the wire format unchanged when no ttl is configured', async () => {
    const post = await buildDefaultAnthropicPayload(requestPayload());
    const explicitDefault = await buildDefaultAnthropicPayload(
      requestPayload({ contextCachingTTL: '5m' }),
    );
    const json = JSON.stringify(post);

    expect(explicitDefault).toEqual(post);
    expect(json).toContain('"cache_control":{"type":"ephemeral"}');
    expect(json).not.toContain('"ttl"');
  });

  it('stamps ttl 1h on every cached layer and resolves the pricing ttl from it', async () => {
    const payload = requestPayload({
      contextCachingTTL: '1h',
      tools: [
        {
          function: { description: 'test tool', name: 'tool1', parameters: {} },
          type: 'function',
        },
      ],
    });
    const post = await buildDefaultAnthropicPayload(payload);

    // System, messages and tools are stamped separately; the pricing resolver reads the
    // first ttl it finds, so asserting a single layer would let a drop on the others survive.
    const systemBlocks = post.system as { cache_control?: { ttl?: string; type: string } }[];
    expect(systemBlocks[0].cache_control).toEqual({ ttl: '1h', type: 'ephemeral' });

    const lastMessage = post.messages.at(-1);
    const lastContent = Array.isArray(lastMessage?.content)
      ? lastMessage.content.at(-1)
      : undefined;
    expect((lastContent as { cache_control?: unknown } | undefined)?.cache_control).toEqual({
      ttl: '1h',
      type: 'ephemeral',
    });

    const tools = post.tools as { cache_control?: unknown }[];
    expect(tools.at(-1)?.cache_control).toEqual({ ttl: '1h', type: 'ephemeral' });

    expect(resolveDefaultAnthropicPricingOptions(payload, post)).toEqual({
      lookupParams: { ttl: '1h' },
    });
  });

  it('resolves the pricing ttl from the tools when they are the only stamped layer', () => {
    // No system prompt, and the message breakpoint can be removed together with an
    // unsupported assistant prefill: the last tool is then the only cache_control left.
    expect(
      resolveDefaultAnthropicPricingOptions(requestPayload({ contextCachingTTL: '1h' }), {
        max_tokens: 1,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-opus-5',
        tools: [
          {
            cache_control: { ttl: '1h', type: 'ephemeral' },
            input_schema: { type: 'object' },
            name: 'tool1',
          },
        ],
      }),
    ).toEqual({ lookupParams: { ttl: '1h' } });
  });

  it('sends no cache_control and resolves no pricing options when caching is disabled, even with a ttl configured', async () => {
    const payload = requestPayload({ contextCachingTTL: '1h', enabledContextCaching: false });
    const post = await buildDefaultAnthropicPayload(payload);

    expect(JSON.stringify(post)).not.toContain('cache_control');
    expect(resolveDefaultAnthropicPricingOptions(payload, post)).toBeUndefined();
  });
});
