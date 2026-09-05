import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initModelRuntimeFromServerConfig,
  resolveServerDefaultHeterogeneousModel,
} from '@/server/modules/ModelRuntime';

import {
  describeRelayFailure,
  encodeAnthropicStream,
  encodeResponsesStream,
  invokeServerDefaultModel,
  normalizeAnthropicRequest,
  normalizeResponsesRequest,
} from './heterogeneous-direct.service';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromServerConfig: vi.fn(),
  resolveServerDefaultHeterogeneousModel: vi.fn(),
}));

const protocolStream = (events: Array<{ data: unknown; id?: string; type: string }>) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(
            `${event.id ? `id: ${event.id}\n` : ''}event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
          ),
        );
      }
      controller.close();
    },
  });
};

const ANTHROPIC_STREAM_MODEL = 'lobehub/claude-sonnet-4-6';
const RESPONSES_STREAM_MODEL = 'lobehub/gpt-5.4';

const readText = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

const anthropicSse = (source: ReadableStream<Uint8Array>) =>
  encodeAnthropicStream(source, ANTHROPIC_STREAM_MODEL);
const responsesSse = (source: ReadableStream<Uint8Array>) =>
  encodeResponsesStream(source, RESPONSES_STREAM_MODEL);

const parseSseEvents = (output: string) =>
  output
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
      const type = lines.find((line) => line.startsWith('event: '))?.slice(7);
      return { data: data === '[DONE]' ? data : JSON.parse(data || 'null'), type };
    });

describe('heterogeneous direct invocation protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves adaptive thinking through the Anthropic relay for a compatible model', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('stream'));
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockResolvedValue({
      model: 'claude-sonnet-4-6',
      provider: 'lobehub',
      supportsAdaptiveThinking: true,
    });
    vi.mocked(initModelRuntimeFromServerConfig).mockResolvedValue({
      chat,
    } as unknown as Awaited<ReturnType<typeof initModelRuntimeFromServerConfig>>);

    const result = await invokeServerDefaultModel({
      agentType: 'claude-code',
      model: 'claude-sonnet-4-6',
      payload: normalizeAnthropicRequest(
        {
          messages: [],
          model: 'lobehub-default',
          stream: true,
          thinking: { type: 'adaptive' },
        },
        'lobehub-default',
      ),
      signal: new AbortController().signal,
      userId: 'user-1',
    });

    expect(result.model).toBe('claude-sonnet-4-6');
    expect(resolveServerDefaultHeterogeneousModel).toHaveBeenCalledWith(
      'claude-code',
      'claude-sonnet-4-6',
    );
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [],
        model: 'claude-sonnet-4-6',
        stream: true,
        thinking: { type: 'adaptive' },
      }),
      expect.any(Object),
    );
  });

  it('drops adaptive thinking for Claude Code relay models without declared support', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('stream'));
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockResolvedValue({
      model: 'doubao-seed-2.1-pro',
      provider: 'lobehub',
      supportsAdaptiveThinking: false,
    });
    vi.mocked(initModelRuntimeFromServerConfig).mockResolvedValue({
      chat,
    } as unknown as Awaited<ReturnType<typeof initModelRuntimeFromServerConfig>>);

    await invokeServerDefaultModel({
      agentType: 'claude-code',
      model: 'doubao-seed-2.1-pro',
      payload: {
        messages: [],
        model: 'lobehub-default',
        stream: true,
        thinking: { type: 'adaptive' },
      },
      signal: new AbortController().signal,
      userId: 'user-1',
    });

    const runtimePayload = chat.mock.calls[0][0];
    expect(runtimePayload).toMatchObject({
      messages: [],
      model: 'doubao-seed-2.1-pro',
      stream: true,
    });
    expect(runtimePayload).not.toHaveProperty('thinking');
  });

  it('uses deployment names as model IDs for runtimes without a dedicated field', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('stream'));
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockResolvedValue({
      deploymentName: 'prod-gpt',
      model: 'gpt-5.4',
      provider: 'lobehub',
      supportsAdaptiveThinking: false,
    });
    vi.mocked(initModelRuntimeFromServerConfig).mockResolvedValue({
      chat,
    } as unknown as Awaited<ReturnType<typeof initModelRuntimeFromServerConfig>>);

    const result = await invokeServerDefaultModel({
      agentType: 'codex',
      model: 'gpt-5.4',
      payload: {
        messages: [],
        model: 'lobehub-default',
        reasoning: { effort: 'high', summary: 'detailed' },
        stream: true,
      },
      signal: new AbortController().signal,
      userId: 'user-1',
    });

    const runtimePayload = chat.mock.calls[0][0];
    expect(result.model).toBe('prod-gpt');
    expect(runtimePayload).toMatchObject({
      apiMode: 'responses',
      messages: [],
      model: 'prod-gpt',
      reasoning: { effort: 'high', summary: 'detailed' },
      stream: true,
    });
    expect(runtimePayload).not.toHaveProperty('deploymentName');
  });

  it('lets non-Codex Responses relays use the upstream protocol selected by the router', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('stream'));
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockResolvedValue({
      model: 'kimi-k3',
      provider: 'lobehub',
      supportsAdaptiveThinking: false,
    });
    vi.mocked(initModelRuntimeFromServerConfig).mockResolvedValue({
      chat,
    } as unknown as Awaited<ReturnType<typeof initModelRuntimeFromServerConfig>>);

    await invokeServerDefaultModel({
      agentType: 'grok-build',
      model: 'kimi-k3',
      payload: normalizeResponsesRequest(
        {
          input: 'hello',
          model: 'lobehub-default',
          reasoning: { effort: 'high', summary: 'auto' },
          stream: true,
        },
        'lobehub-default',
      ),
      signal: new AbortController().signal,
      userId: 'user-1',
    });

    expect(chat.mock.calls[0][0]).toMatchObject({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'kimi-k3',
      reasoning_effort: 'high',
      stream: true,
    });
    expect(chat.mock.calls[0][0]).not.toHaveProperty('apiMode');
    expect(chat.mock.calls[0][0]).not.toHaveProperty('reasoning');
  });

  it('adapts custom Codex relay models to chat completions with their reasoning effort', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('stream'));
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockResolvedValue({
      model: 'deepseek-v4-pro',
      provider: 'lobehub',
      supportsAdaptiveThinking: false,
    });
    vi.mocked(initModelRuntimeFromServerConfig).mockResolvedValue({
      chat,
    } as unknown as Awaited<ReturnType<typeof initModelRuntimeFromServerConfig>>);

    await invokeServerDefaultModel({
      agentType: 'codex',
      model: 'deepseek-v4-pro',
      payload: {
        apiMode: 'responses',
        messages: [],
        model: 'lobehub-default',
        reasoning: { effort: 'max', summary: 'detailed' },
        stream: true,
      },
      signal: new AbortController().signal,
      userId: 'user-1',
    });

    const runtimePayload = chat.mock.calls[0][0];
    expect(runtimePayload).toMatchObject({
      apiMode: 'chatCompletion',
      messages: [],
      model: 'deepseek-v4-pro',
      reasoning_effort: 'max',
      stream: true,
    });
    expect(runtimePayload).not.toHaveProperty('reasoning');
  });

  it('fails closed before runtime initialization for an unsupported direct protocol route', async () => {
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockRejectedValue(
      new Error('unsupported agent/runtime pair'),
    );

    await expect(
      invokeServerDefaultModel({
        agentType: 'codex',
        model: 'claude-sonnet-4-6',
        payload: { messages: [], model: 'lobehub-default', stream: true },
        signal: new AbortController().signal,
        userId: 'user-1',
      }),
    ).rejects.toThrow('unsupported agent/runtime pair');
    expect(initModelRuntimeFromServerConfig).not.toHaveBeenCalled();
  });

  it('normalizes Anthropic images, tool calls, and tool results', () => {
    const payload = normalizeAnthropicRequest(
      {
        messages: [
          {
            content: [
              { text: 'look', type: 'text' },
              { source: { data: 'abc', media_type: 'image/png', type: 'base64' }, type: 'image' },
            ],
            role: 'user',
          },
          {
            content: [{ id: 'call-1', input: { path: '/tmp' }, name: 'read', type: 'tool_use' }],
            role: 'assistant',
          },
          {
            content: [
              {
                content: [
                  { text: 'done', type: 'text' },
                  {
                    source: { data: 'result-image', media_type: 'image/jpeg', type: 'base64' },
                    type: 'image',
                  },
                ],
                tool_use_id: 'call-1',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
        ],
        model: 'lobehub-default',
        system: [{ text: 'system', type: 'text' }],
      },
      'lobehub-default',
    );

    expect(payload.messages[0]).toEqual({ content: 'system', role: 'system' });
    expect(payload.messages[1].content).toEqual([
      { text: 'look', type: 'text' },
      { image_url: { url: 'data:image/png;base64,abc' }, type: 'image_url' },
    ]);
    expect(payload.messages[2].tool_calls?.[0]).toMatchObject({ id: 'call-1' });
    expect(payload.messages[3]).toEqual({
      content: [
        { text: 'done', type: 'text' },
        { image_url: { url: 'data:image/jpeg;base64,result-image' }, type: 'image_url' },
      ],
      role: 'tool',
      tool_call_id: 'call-1',
    });
  });

  it.each([
    {
      expected: 'Claude Code system prompt',
      name: 'an array block preceded by an empty text block',
      system: [
        { text: '', type: 'text' },
        {
          text: 'x-anthropic-billing-header: cc_version=2.1.231; cc_entrypoint=sdk-cli;',
          type: 'text',
        },
        { text: 'Claude Code system prompt', type: 'text' },
      ],
    },
    {
      expected: 'Claude Code system prompt',
      name: 'a standalone array block',
      system: [
        {
          text: 'x-anthropic-billing-header: cc_version=2.1.231; cc_entrypoint=sdk-cli;',
          type: 'text',
        },
        { text: 'Claude Code system prompt', type: 'text' },
      ],
    },
    {
      expected: 'Claude Code system prompt',
      name: 'a string followed by an LF blank line',
      system:
        'x-anthropic-billing-header: cc_version=2.1.231; cc_entrypoint=sdk-cli;\n\nClaude Code system prompt',
    },
    {
      expected: 'Claude Code system prompt',
      name: 'an array block followed by a CRLF blank line',
      system: [
        {
          text: 'x-anthropic-billing-header: cc_version=2.1.231;\r\n\r\nClaude Code system prompt',
          type: 'text',
        },
      ],
    },
    {
      expected: undefined,
      name: 'the entire system prompt',
      system: 'x-anthropic-billing-header: cc_version=2.1.231;',
    },
  ])('strips the Claude Code billing attribution when it is $name', ({ expected, system }) => {
    const payload = normalizeAnthropicRequest({ messages: [], system }, 'lobehub-default');

    expect(payload.messages).toEqual(expected ? [{ content: expected, role: 'system' }] : []);
  });

  it('preserves non-leading Anthropic billing header text as user-authored system content', () => {
    const system =
      'Keep this text\nx-anthropic-billing-header: this non-leading occurrence is user content';
    const payload = normalizeAnthropicRequest({ messages: [], system }, 'lobehub-default');

    expect(payload.messages).toEqual([{ content: system, role: 'system' }]);
  });

  it('preserves an Anthropic billing header in a later system text block', () => {
    const payload = normalizeAnthropicRequest(
      {
        messages: [],
        system: [
          { text: 'Keep this text\n', type: 'text' },
          { text: 'x-anthropic-billing-header: this later block is user content', type: 'text' },
        ],
      },
      'lobehub-default',
    );

    expect(payload.messages).toEqual([
      {
        content: 'Keep this text\nx-anthropic-billing-header: this later block is user content',
        role: 'system',
      },
    ]);
  });

  it('unwraps a leading Claude Code system reminder for GPT relay models', () => {
    const payload = normalizeAnthropicRequest(
      {
        messages: [
          {
            content: [
              {
                text: [
                  '<system-reminder>',
                  'As you answer the user, you can use the following context:',
                  '# currentDate',
                  "Today's date is 2026-09-05.",
                  '</system-reminder>',
                  '',
                ].join('\r\n'),
                type: 'text',
              },
              { text: 'Reply with exactly LOBEHUB_HETERO_SMOKE_OK.', type: 'text' },
            ],
            role: 'user',
          },
        ],
      },
      'lobehub-default',
      { unwrapSystemReminders: true },
    );

    expect(payload.messages).toEqual([
      {
        content: [
          '',
          'As you answer the user, you can use the following context:',
          '# currentDate',
          "Today's date is 2026-09-05.",
          '',
          'Reply with exactly LOBEHUB_HETERO_SMOKE_OK.',
        ].join('\r\n'),
        role: 'user',
      },
    ]);
  });

  it('preserves system reminder markup unless unwrapping is explicitly enabled', () => {
    const content = 'Preface\n<system-reminder>user-authored text</system-reminder>';
    const payload = normalizeAnthropicRequest(
      { messages: [{ content, role: 'user' }] },
      'lobehub-default',
      { unwrapSystemReminders: true },
    );
    const defaultPayload = normalizeAnthropicRequest(
      {
        messages: [
          { content: '<system-reminder>Claude context</system-reminder>\n\nPrompt', role: 'user' },
        ],
      },
      'lobehub-default',
    );

    expect(payload.messages).toEqual([{ content, role: 'user' }]);
    expect(defaultPayload.messages).toEqual([
      {
        content: '<system-reminder>Claude context</system-reminder>\n\nPrompt',
        role: 'user',
      },
    ]);
  });

  it('does not unwrap a system reminder in a later text block', () => {
    const payload = normalizeAnthropicRequest(
      {
        messages: [
          {
            content: [
              { text: 'User preface\n', type: 'text' },
              { text: '<system-reminder>user-authored text</system-reminder>', type: 'text' },
            ],
            role: 'user',
          },
        ],
      },
      'lobehub-default',
      { unwrapSystemReminders: true },
    );

    expect(payload.messages).toEqual([
      {
        content: 'User preface\n<system-reminder>user-authored text</system-reminder>',
        role: 'user',
      },
    ]);
  });

  it('preserves Anthropic thinking history across tool rounds', () => {
    const payload = normalizeAnthropicRequest(
      {
        messages: [
          {
            content: [
              { signature: 'signed-thinking', thinking: 'private thought', type: 'thinking' },
              { data: 'encrypted-redacted-thought', type: 'redacted_thinking' },
              { text: 'I will inspect it.', type: 'text' },
              { id: 'call-1', input: { path: '/tmp' }, name: 'read', type: 'tool_use' },
            ],
            role: 'assistant',
          },
        ],
      },
      'lobehub-default',
    );

    expect(payload.messages[0]).toMatchObject({
      content: [
        { signature: 'signed-thinking', thinking: 'private thought', type: 'thinking' },
        { data: 'encrypted-redacted-thought', type: 'redacted_thinking' },
        { text: 'I will inspect it.', type: 'text' },
      ],
      provider: 'anthropic',
      role: 'assistant',
      tool_calls: [{ id: 'call-1' }],
    });
  });

  it('normalizes Pi Responses messages whose optional type is omitted', () => {
    const payload = normalizeResponsesRequest(
      {
        input: [
          { content: 'Pi coding assistant', role: 'system' },
          {
            content: [{ text: 'LOBEHUB_HETERO_SMOKE_OK', type: 'input_text' }],
            role: 'user',
          },
        ],
        max_output_tokens: 16_384,
        model: 'lobehub/glm-5.2',
        stream: true,
      },
      'lobehub-default',
    );

    expect(payload.messages).toEqual([
      { content: 'Pi coding assistant', role: 'system' },
      { content: 'LOBEHUB_HETERO_SMOKE_OK', role: 'user' },
    ]);
    expect(payload.max_tokens).toBe(16_384);
    expect(payload).not.toHaveProperty('apiMode');
  });

  it('normalizes two-round Responses reasoning and function call continuity', () => {
    const firstReasoning = {
      encrypted_content: 'encrypted-first',
      id: 'reasoning-1',
      status: 'completed',
      summary: [{ text: 'first thought', type: 'summary_text' }],
      type: 'reasoning',
    };
    const secondReasoning = {
      encrypted_content: 'encrypted-second',
      id: 'reasoning-2',
      status: 'completed',
      summary: [],
      type: 'reasoning',
    };
    const payload = normalizeResponsesRequest(
      {
        input: [
          firstReasoning,
          { arguments: '{"q":"x"}', call_id: 'call-1', name: 'search', type: 'function_call' },
          { call_id: 'call-1', output: 'result', type: 'function_call_output' },
          secondReasoning,
          {
            content: [{ text: 'answer', type: 'output_text' }],
            role: 'assistant',
            type: 'message',
          },
        ],
        instructions: 'system',
      },
      'lobehub-default',
    );

    expect(payload.messages.map(({ role }) => role)).toEqual([
      'system',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(payload.messages[1].reasoning?.responseItems).toEqual([firstReasoning]);
    expect(payload.messages[2].tool_call_id).toBe('call-1');
    expect(payload.messages[3].reasoning?.responseItems).toEqual([secondReasoning]);
  });

  it('groups parallel Responses function calls before their contiguous outputs', () => {
    const reasoning = {
      encrypted_content: 'encrypted-parallel',
      id: 'reasoning-parallel',
      status: 'completed',
      summary: [{ text: 'parallel thought', type: 'summary_text' }],
      type: 'reasoning',
    };
    const payload = normalizeResponsesRequest(
      {
        input: [
          reasoning,
          { arguments: '{"q":"x"}', call_id: 'call-1', name: 'search', type: 'function_call' },
          { arguments: '{"path":"/tmp"}', call_id: 'call-2', name: 'read', type: 'function_call' },
          { call_id: 'call-1', output: 'search result', type: 'function_call_output' },
          { call_id: 'call-2', output: 'file result', type: 'function_call_output' },
        ],
      },
      'lobehub-default',
    );

    expect(payload.messages.map(({ role }) => role)).toEqual(['assistant', 'tool', 'tool']);
    expect(payload.messages[0]).toMatchObject({
      reasoning: { responseItems: [reasoning] },
      tool_calls: [{ id: 'call-1' }, { id: 'call-2' }],
    });
    expect(payload.messages.slice(1).map(({ tool_call_id }) => tool_call_id)).toEqual([
      'call-1',
      'call-2',
    ]);
  });

  it('parses the final protocol event without a trailing newline', async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: text\ndata: "tail"'));
        controller.close();
      },
    });

    await expect(readText(anthropicSse(source))).resolves.toContain(
      '"text":"tail","type":"text_delta"',
    );
  });

  it('encodes Anthropic reasoning and parallel tool argument deltas', async () => {
    const output = await readText(
      anthropicSse(
        protocolStream([
          { data: 'thinking', type: 'reasoning' },
          {
            data: [
              { function: { arguments: '{', name: 'one' }, id: 'call-1', index: 0 },
              { function: { arguments: '{', name: 'two' }, id: 'call-2', index: 1 },
            ],
            type: 'tool_calls',
          },
          { data: 'tool_calls', type: 'stop' },
        ]),
      ),
    );

    expect(output).toContain('"type":"thinking_delta"');
    expect(output).toContain('"id":"call-1"');
    expect(output).toContain('"id":"call-2"');
    expect(output).toContain('"stop_reason":"tool_use"');
  });

  it('encodes Gemini textual part events through the Anthropic relay', async () => {
    const events = parseSseEvents(
      await readText(
        anthropicSse(
          protocolStream([
            {
              data: { content: 'thinking', inReasoning: true, partType: 'text' },
              type: 'reasoning_part',
            },
            { data: { content: 'answer', partType: 'text' }, type: 'content_part' },
            {
              data: { content: 'base64-image', mimeType: 'image/png', partType: 'image' },
              type: 'content_part',
            },
            { data: 'STOP', type: 'stop' },
            { data: { totalInputTokens: 7, totalOutputTokens: 4 }, type: 'usage' },
          ]),
        ),
      ),
    );
    const deltas = events
      .filter(({ type }) => type === 'content_block_delta')
      .map(({ data }) => data.delta);

    expect(deltas).toEqual([
      { thinking: 'thinking', type: 'thinking_delta' },
      { text: 'answer', type: 'text_delta' },
    ]);
    expect(events.at(-2)?.data).toMatchObject({
      delta: { stop_reason: 'end_turn' },
      usage: { input_tokens: 7, output_tokens: 4 },
    });
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('preserves Anthropic signature-only reasoning blocks', async () => {
    const events = parseSseEvents(
      await readText(
        anthropicSse(
          protocolStream([
            { data: '', type: 'reasoning' },
            { data: 'hidden-thinking-signature', type: 'reasoning_signature' },
          ]),
        ),
      ),
    );
    const thinkingStart = events.find(({ type }) => type === 'content_block_start');
    const deltas = events
      .filter(({ type }) => type === 'content_block_delta')
      .map(({ data }) => data.delta);

    expect(thinkingStart?.data).toMatchObject({
      content_block: { signature: '', thinking: '', type: 'thinking' },
      index: 0,
    });
    expect(deltas).toEqual([{ signature: 'hidden-thinking-signature', type: 'signature_delta' }]);
    expect(events.filter(({ type }) => type === 'content_block_stop')).toHaveLength(1);
  });

  it('does not stringify null Anthropic text and reasoning chunks', async () => {
    const events = parseSseEvents(
      await readText(
        anthropicSse(
          protocolStream([
            { data: 'answer', type: 'text' },
            { data: null, type: 'text' },
            { data: null, type: 'reasoning' },
            { data: null, type: 'reasoning_signature' },
          ]),
        ),
      ),
    );
    const deltas = events
      .filter(({ type }) => type === 'content_block_delta')
      .map(({ data }) => data.delta);

    expect(deltas).toEqual([{ text: 'answer', type: 'text_delta' }]);
  });

  it('finalizes Anthropic stop, usage, and message_stop exactly once', async () => {
    const output = await readText(
      anthropicSse(
        protocolStream([
          { data: 'hello', type: 'text' },
          { data: 'end_turn', type: 'stop' },
          { data: { totalInputTokens: 7, totalOutputTokens: 4 }, type: 'usage' },
          { data: 'message_stop', type: 'stop' },
        ]),
      ),
    );

    const events = parseSseEvents(output);
    expect(events.slice(-3).map(({ type }) => type)).toEqual([
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    expect(events.filter(({ type }) => type === 'content_block_stop')).toHaveLength(1);
    expect(events.filter(({ type }) => type === 'message_delta')).toHaveLength(1);
    expect(events.filter(({ type }) => type === 'message_stop')).toHaveLength(1);
    expect(events.at(-2)?.data).toMatchObject({
      delta: { stop_reason: 'end_turn' },
    });
    expect(events.at(-2)?.data.usage).toEqual({ input_tokens: 7, output_tokens: 4 });
  });

  it('forwards Anthropic cache-split input on message_delta without double-counting', async () => {
    const output = await readText(
      anthropicSse(
        protocolStream([
          { data: 'hello', type: 'text' },
          {
            data: {
              inputCachedTokens: 10,
              inputCacheMissTokens: 90,
              inputWriteCacheTokens: 20,
              totalInputTokens: 120,
              totalOutputTokens: 5,
            },
            type: 'usage',
          },
        ]),
      ),
    );

    const delta = parseSseEvents(output).find(({ type }) => type === 'message_delta');
    expect(delta?.data.usage).toEqual({
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 10,
      input_tokens: 90,
      output_tokens: 5,
    });
  });

  it('echoes the namespaced catalog model on Anthropic message_start and Responses objects', async () => {
    const anthropic = parseSseEvents(
      await readText(
        encodeAnthropicStream(
          protocolStream([{ data: 'hi', type: 'text' }]),
          ANTHROPIC_STREAM_MODEL,
        ),
      ),
    );
    expect(anthropic[0]).toMatchObject({
      data: { message: { model: ANTHROPIC_STREAM_MODEL } },
      type: 'message_start',
    });

    const responses = await readText(
      encodeResponsesStream(protocolStream([{ data: 'hi', type: 'text' }]), RESPONSES_STREAM_MODEL),
    );
    expect(responses).toContain(`"model":"${RESPONSES_STREAM_MODEL}"`);
  });

  it.each([
    {
      events: [
        { data: 'hello', type: 'text' },
        { data: { totalInputTokens: 2, totalOutputTokens: 1 }, type: 'usage' },
      ],
      name: 'usage without stop',
    },
    {
      events: [
        { data: 'hello', type: 'text' },
        { data: 'stop', type: 'stop' },
        { data: { totalInputTokens: 2, totalOutputTokens: 1 }, type: 'usage' },
      ],
      name: 'stop before usage',
    },
    {
      events: [
        { data: 'hello', type: 'text' },
        { data: 'end_turn', type: 'stop' },
        { data: { totalInputTokens: 2, totalOutputTokens: 1 }, type: 'usage' },
        { data: 'message_stop', type: 'stop' },
      ],
      name: 'duplicate stop sentinels',
    },
  ])('finalizes Responses $name exactly once', async ({ events: protocolEvents }) => {
    const output = await readText(responsesSse(protocolStream(protocolEvents)));
    const events = parseSseEvents(output);
    const nativeEvents = events.filter(({ type }) => type);
    const terminalEvents = nativeEvents.filter(({ type }) =>
      ['response.completed', 'response.failed', 'response.incomplete'].includes(type!),
    );

    expect(output).toContain('event: response.output_text.delta');
    expect(output).toContain('event: response.content_part.done');
    expect(output).toContain('event: response.output_item.done');
    expect(output).not.toContain('totalInputTokens');
    expect(output).toContain('"output":[{"content":[{"annotations":[],"text":"hello"');
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]).toMatchObject({
      data: {
        response: {
          usage: {
            input_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 1,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 3,
          },
        },
        type: 'response.completed',
      },
      type: 'response.completed',
    });
    expect(nativeEvents.map(({ data }) => data.sequence_number)).toEqual(
      nativeEvents.map((_, index) => index),
    );
    expect(events.slice(events.indexOf(terminalEvents[0]) + 1)).toEqual([
      { data: '[DONE]', type: undefined },
    ]);
  });

  it('encodes complete Responses usage details without stringifying null chunks', async () => {
    const events = parseSseEvents(
      await readText(
        responsesSse(
          protocolStream([
            { data: 'answer', type: 'text' },
            { data: null, type: 'text' },
            { data: null, type: 'reasoning' },
            {
              data: {
                inputCachedTokens: 3,
                outputReasoningTokens: 2,
                totalInputTokens: 7,
                totalOutputTokens: 4,
              },
              type: 'usage',
            },
          ]),
        ),
      ),
    );
    const textDeltas = events
      .filter(({ type }) => type === 'response.output_text.delta')
      .map(({ data }) => data.delta);
    const reasoningDeltas = events.filter(
      ({ type }) => type === 'response.reasoning_summary_text.delta',
    );
    const completed = events.find(({ type }) => type === 'response.completed');

    expect(textDeltas).toEqual(['answer']);
    expect(reasoningDeltas).toHaveLength(0);
    expect(completed?.data.response.output[0].content[0].text).toBe('answer');
    expect(completed?.data.response.usage).toEqual({
      input_tokens: 7,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens: 4,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 11,
    });
  });

  it('encodes Gemini text and reasoning parts as Responses output', async () => {
    const events = parseSseEvents(
      await readText(
        responsesSse(
          protocolStream([
            {
              data: { content: 'thinking', inReasoning: true, partType: 'text' },
              type: 'reasoning_part',
            },
            { data: { content: 'answer', partType: 'text' }, type: 'content_part' },
            {
              data: { content: 'base64-image', mimeType: 'image/png', partType: 'image' },
              type: 'content_part',
            },
          ]),
        ),
      ),
    );
    const textDeltas = events
      .filter(({ type }) => type === 'response.output_text.delta')
      .map(({ data }) => data.delta);
    const reasoningDeltas = events
      .filter(({ type }) => type === 'response.reasoning_summary_text.delta')
      .map(({ data }) => data.delta);
    const completed = events.find(({ type }) => type === 'response.completed');

    expect(textDeltas).toEqual(['answer']);
    expect(reasoningDeltas).toEqual(['thinking']);
    expect(completed?.data.response.output).toEqual([
      {
        id: expect.any(String),
        status: 'completed',
        summary: [{ text: 'thinking', type: 'summary_text' }],
        type: 'reasoning',
      },
      {
        content: [{ annotations: [], text: 'answer', type: 'output_text' }],
        id: expect.any(String),
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
    ]);
  });

  it('encodes Responses incomplete and failed terminal lifecycle events', async () => {
    const incomplete = await readText(
      responsesSse(
        protocolStream([
          { data: 'partial', type: 'text' },
          { data: 'max_tokens', type: 'stop' },
        ]),
      ),
    );
    expect(incomplete).toContain('event: response.incomplete');
    expect(incomplete).toContain('"status":"incomplete"');
    expect(incomplete).toContain('"incomplete_details":{"reason":"max_output_tokens"}');
    expect(incomplete).not.toContain('event: response.completed');

    const failed = await readText(
      responsesSse(protocolStream([{ data: { message: 'provider unavailable' }, type: 'error' }])),
    );
    expect(failed).toContain('event: response.failed');
    expect(failed).toContain('"error":{"code":"server_error","message":"provider unavailable"}');
    expect(failed).toContain('data: [DONE]');
    const failedEvents = parseSseEvents(failed).filter(({ type }) => type);
    expect(failedEvents.map(({ data }) => data.sequence_number)).toEqual([0, 1]);
  });

  it('assigns distinct Responses output indexes to reasoning, text, and tools', async () => {
    const output = await readText(
      responsesSse(
        protocolStream([
          { data: 'think', type: 'reasoning' },
          { data: 'answer', type: 'text' },
          {
            data: [{ function: { arguments: '{}', name: 'search' }, id: 'call-1', index: 0 }],
            type: 'tool_calls',
          },
          { data: 'tool_calls', type: 'stop' },
        ]),
      ),
    );
    const indexes = [
      ...output.matchAll(/event: response\.output_item\.added\ndata: ([^\n]+)/g),
    ].map((match) => JSON.parse(match[1]).output_index);

    expect(indexes).toEqual([0, 1, 2]);
    expect(output).toContain('event: response.reasoning_summary_text.done');
  });

  it('completes replayed encrypted reasoning response items', async () => {
    const reasoningItem = {
      encrypted_content: 'encrypted-history',
      id: 'reasoning-history',
      status: 'completed',
      summary: [],
      type: 'reasoning',
    };
    const output = await readText(
      responsesSse(
        protocolStream([
          { data: reasoningItem, type: 'reasoning_response_item' },
          { data: 'stop', type: 'stop' },
        ]),
      ),
    );
    const doneItems = [
      ...output.matchAll(/event: response\.output_item\.done\ndata: ([^\n]+)/g),
    ].map((match) => JSON.parse(match[1]).item);

    expect(doneItems).toContainEqual(reasoningItem);
  });

  it('completes streamed reasoning with its encrypted response item only once', async () => {
    const reasoningItem = {
      encrypted_content: 'encrypted-current',
      id: 'reasoning-current',
      status: 'completed',
      summary: [{ text: 'thinking', type: 'summary_text' }],
      type: 'reasoning',
    };
    const events = parseSseEvents(
      await readText(
        responsesSse(
          protocolStream([
            { data: 'thinking', id: 'reasoning-current', type: 'reasoning' },
            {
              data: reasoningItem,
              id: 'reasoning-current',
              type: 'reasoning_response_item',
            },
            { data: 'stop', type: 'stop' },
          ]),
        ),
      ),
    );
    const reasoningAdded = events.filter(
      ({ data, type }) => type === 'response.output_item.added' && data.item.type === 'reasoning',
    );
    const reasoningDone = events.filter(
      ({ data, type }) => type === 'response.output_item.done' && data.item.type === 'reasoning',
    );
    const completed = events.find(({ type }) => type === 'response.completed');

    expect(reasoningAdded).toHaveLength(1);
    expect(reasoningDone).toHaveLength(1);
    expect(reasoningAdded[0].data.output_index).toBe(reasoningDone[0].data.output_index);
    expect(reasoningAdded[0].data.item.id).toBe('reasoning-current');
    expect(reasoningDone[0].data.item).toEqual(reasoningItem);
    expect(completed?.data.response.output).toEqual([reasoningItem]);
  });
});

/**
 * `runtime.chat` rejects with a plain `{ error, errorType, provider }` object
 * rather than an `Error`. Hono cannot serialise that, so before this helper an
 * uncaught rejection reached the client as a 500 with an EMPTY body — which is
 * how a Volcengine `invalid value adaptive` looked to Claude Code:
 * `API Error: 500 status code (no body)`, retried for 98 seconds.
 */
describe('describeRelayFailure', () => {
  it('carries the provider’s own words out of a runtime rejection', () => {
    expect(
      describeRelayFailure({
        error: {
          message:
            'The parameter `type` specified in the request are not valid: invalid value adaptive.',
        },
        errorType: 'ProviderBizError',
        provider: 'volcengine',
      }),
    ).toEqual({
      message:
        '[volcengine] ProviderBizError: The parameter `type` specified in the request are not valid: invalid value adaptive.',
      status: 502,
    });
  });

  it('falls back to the serialized body when the provider names no message', () => {
    const { message } = describeRelayFailure({
      error: { code: 'InvalidParameter' },
      errorType: 'ProviderBizError',
      provider: 'volcengine',
    });

    expect(message).toContain('InvalidParameter');
  });

  it('still says something for a plain Error', () => {
    expect(describeRelayFailure(new Error('socket hang up'))).toEqual({
      message: 'socket hang up',
      status: 502,
    });
  });

  it('never returns an empty message, whatever it was handed', () => {
    for (const thrown of [undefined, null, '', 0, {}]) {
      expect(describeRelayFailure(thrown).message).not.toBe('');
    }
  });
});
