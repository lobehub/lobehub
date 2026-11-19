// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { AgentRuntimeErrorType } from '../../types/error';
import { LobeAceDataCloudAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

testProvider({
  Runtime: LobeAceDataCloudAI,
  chatDebugEnv: 'DEBUG_ACEDATACLOUD_CHAT_COMPLETION',
  chatModel: 'example-chat-model',
  defaultBaseURL: 'https://api.acedata.cloud/v1',
  provider: ModelProvider.AceDataCloud,
});

const completion = {
  choices: [{ finish_reason: 'stop', index: 0, message: { content: 'Hello', role: 'assistant' } }],
  created: 1,
  id: 'test-completion',
  model: 'example-chat-model',
  object: 'chat.completion',
  usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });

describe('Ace Data Cloud endpoint contract', () => {
  it('fetches models with Bearer auth, excludes media endpoints and avoids vendor price guesses', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          'example-chat-model',
          'gpt-6-astra',
          'gemini-2.5-pro',
          'claude-sonnet-4-5',
          'dall-e-3',
          'gemini-3.1-flash-image',
          'gpt-image-2',
          'nano-banana-pro',
          'text-embedding-3-small',
          'gpt-4o-image',
        ].map((id) => ({ created: 1, id, object: 'model', owned_by: 'acedatacloud' })),
        object: 'list',
      }),
    );
    const runtime = new LobeAceDataCloudAI({ apiKey: 'dummy-token', fetch });
    const models = await runtime.models();
    const [url, options] = fetch.mock.calls[0];

    expect(String(url)).toBe('https://api.acedata.cloud/v1/models');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer dummy-token');
    expect(models).toEqual(
      ['example-chat-model', 'gpt-6-astra', 'gemini-2.5-pro', 'claude-sonnet-4-5'].map((id) => ({
        displayName: id,
        id,
        type: 'chat',
      })),
    );
  });

  it('preserves a user-supplied endpoint and surfaces model-fetch authorization failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: 'Invalid token' } }, 401));
    const runtime = new LobeAceDataCloudAI({
      apiKey: 'dummy-token',
      baseURL: 'https://custom.example/v1',
      fetch,
    });

    await expect(runtime.models()).rejects.toMatchObject({ status: 401 });
    expect(String(fetch.mock.calls[0][0])).toBe('https://custom.example/v1/models');
  });

  it('keeps non-streaming chat and function tools on the configured completion endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(completion));
    const runtime = new LobeAceDataCloudAI({ apiKey: 'dummy-token', fetch });
    const response = await runtime.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'example-chat-model',
      stream: false,
      tools: [
        {
          function: { name: 'lookup', parameters: { properties: {}, type: 'object' } },
          type: 'function',
        },
      ],
    });
    const [url, options] = fetch.mock.calls[0];
    const payload = JSON.parse(String(options.body));

    expect(String(url)).toBe('https://api.acedata.cloud/v1/chat/completions');
    expect(payload.stream).toBe(false);
    expect(payload.tools[0].function.name).toBe('lookup');
    expect(await response.text()).toContain('Hello');
  });
});

it('keeps structured generation on the requested protocol without manufacturing a fallback model', async () => {
  const fetch = vi.fn().mockResolvedValue(
    jsonResponse({
      ...completion,
      choices: [
        { ...completion.choices[0], message: { content: '{"ok":true}', role: 'assistant' } },
      ],
    }),
  );
  const runtime = new LobeAceDataCloudAI({ apiKey: 'dummy-token', fetch });
  const result = await runtime.generateObject({
    messages: [{ content: 'Return JSON', role: 'user' }],
    model: 'example-chat-model',
    schema: {
      name: 'result',
      schema: { properties: { ok: { type: 'boolean' } }, required: ['ok'], type: 'object' },
    },
  });
  const [url, options] = fetch.mock.calls[0];

  expect(String(url)).toBe('https://api.acedata.cloud/v1/chat/completions');
  expect(JSON.parse(String(options.body)).model).toBe('example-chat-model');
  expect(result).toEqual({ ok: true });
});

describe('Ace deployment and error boundaries', () => {
  it.each([undefined, '', '   '])('rejects a missing API key before a request (%s)', (apiKey) => {
    const fetch = vi.fn();
    expect(() => new LobeAceDataCloudAI({ apiKey, fetch })).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'invalid_api_key', 'Invalid token', AgentRuntimeErrorType.InvalidProviderAPIKey],
    [
      403,
      'content_policy_violation',
      'Content policy violation',
      AgentRuntimeErrorType.ProviderContentPolicyViolation,
    ],
    [429, 'rate_limit_exceeded', 'Rate limit exceeded', AgentRuntimeErrorType.RateLimitExceeded],
    [500, 'internal_error', 'Internal server error', AgentRuntimeErrorType.ProviderBizError],
  ])('preserves a useful error boundary for HTTP %s', async (status, code, message, errorType) => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ error: { code, message } }, status));
    const runtime = new LobeAceDataCloudAI({ apiKey: 'dummy-token', fetch, maxRetries: 0 });

    await expect(
      runtime.chat({
        messages: [{ content: 'local synthetic failure', role: 'user' }],
        model: 'example-chat-model',
        stream: false,
      }),
    ).rejects.toMatchObject({ errorType, provider: ModelProvider.AceDataCloud });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.acedata.cloud/v1/chat/completions');
  });

  it('passes the requested model unchanged through a real streaming response', async () => {
    const chunks = [
      {
        id: 'test-stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'example-chat-model',
        choices: [
          { index: 0, delta: { role: 'assistant', content: 'Hello stream' }, finish_reason: null },
        ],
      },
      {
        id: 'test-stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'example-chat-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ];
    const text =
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    const fetch = vi.fn().mockResolvedValue(
      new Response(text, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const runtime = new LobeAceDataCloudAI({ apiKey: 'dummy-token', fetch });
    const response = await runtime.chat({
      messages: [{ content: 'local stream', role: 'user' }],
      model: 'example-chat-model',
      stream: true,
    });
    expect(await response.text()).toContain('Hello stream');
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body.model).toBe('example-chat-model');
    expect(body.stream).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
