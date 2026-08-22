import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initModelRuntimeFromServerConfig,
  resolveServerDefaultHeterogeneousModel,
} from '@/server/modules/ModelRuntime';

import {
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

const readText = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

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

  it('invokes Claude Code through an Anthropic-compatible LobeHub relay model', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('stream'));
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockResolvedValue({
      model: 'claude-sonnet-4-6',
      provider: 'lobehub',
    });
    vi.mocked(initModelRuntimeFromServerConfig).mockResolvedValue({
      chat,
    } as unknown as Awaited<ReturnType<typeof initModelRuntimeFromServerConfig>>);

    const result = await invokeServerDefaultModel({
      agentType: 'claude-code',
      model: 'claude-sonnet-4-6',
      payload: { messages: [], model: 'lobehub-default', stream: true },
      signal: new AbortController().signal,
      userId: 'user-1',
    });

    expect(result.model).toBe('claude-sonnet-4-6');
    expect(resolveServerDefaultHeterogeneousModel).toHaveBeenCalledWith(
      'claude-code',
      'claude-sonnet-4-6',
    );
    expect(chat).toHaveBeenCalledWith(
      {
        messages: [],
        model: 'claude-sonnet-4-6',
        stream: true,
      },
      expect.any(Object),
    );
  });

  it('uses deployment names as model IDs for runtimes without a dedicated field', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('stream'));
    vi.mocked(resolveServerDefaultHeterogeneousModel).mockResolvedValue({
      deploymentName: 'prod-gpt',
      model: 'gpt-5.4',
      provider: 'lobehub',
    });
    vi.mocked(initModelRuntimeFromServerConfig).mockResolvedValue({
      chat,
    } as unknown as Awaited<ReturnType<typeof initModelRuntimeFromServerConfig>>);

    const result = await invokeServerDefaultModel({
      agentType: 'codex',
      model: 'gpt-5.4',
      payload: { messages: [], model: 'lobehub-default', stream: true },
      signal: new AbortController().signal,
      userId: 'user-1',
    });

    const runtimePayload = chat.mock.calls[0][0];
    expect(result.model).toBe('prod-gpt');
    expect(runtimePayload).toMatchObject({ messages: [], model: 'prod-gpt', stream: true });
    expect(runtimePayload).not.toHaveProperty('deploymentName');
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

  it('parses the final protocol event without a trailing newline', async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: text\ndata: "tail"'));
        controller.close();
      },
    });

    await expect(readText(encodeAnthropicStream(source))).resolves.toContain(
      '"text":"tail","type":"text_delta"',
    );
  });

  it('encodes Anthropic reasoning and parallel tool argument deltas', async () => {
    const output = await readText(
      encodeAnthropicStream(
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

  it('finalizes Anthropic stop, usage, and message_stop exactly once', async () => {
    const output = await readText(
      encodeAnthropicStream(
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
      usage: { output_tokens: 4 },
    });
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
    const output = await readText(encodeResponsesStream(protocolStream(protocolEvents)));
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
        response: { usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } },
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

  it('encodes Responses incomplete and failed terminal lifecycle events', async () => {
    const incomplete = await readText(
      encodeResponsesStream(
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
      encodeResponsesStream(
        protocolStream([{ data: { message: 'provider unavailable' }, type: 'error' }]),
      ),
    );
    expect(failed).toContain('event: response.failed');
    expect(failed).toContain('"error":{"code":"server_error","message":"provider unavailable"}');
    expect(failed).toContain('data: [DONE]');
    const failedEvents = parseSseEvents(failed).filter(({ type }) => type);
    expect(failedEvents.map(({ data }) => data.sequence_number)).toEqual([0, 1]);
  });

  it('assigns distinct Responses output indexes to reasoning, text, and tools', async () => {
    const output = await readText(
      encodeResponsesStream(
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
      encodeResponsesStream(
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
        encodeResponsesStream(
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
