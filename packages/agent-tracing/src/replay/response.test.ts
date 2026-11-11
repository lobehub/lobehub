import { afterEach, describe, expect, it, vi } from 'vitest';

import { replayFrozenCall } from './replayFrozenCall';
import { aggregateSSECompletion, readReplayCompletion } from './response';

const frame = (id: string, event: string, data: unknown) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** What `/webapi/chat` streams back for a Responses-API provider that forces streaming. */
const responsesSSE = [
  frame('rs_00a1', 'reasoning', ''),
  frame('rs_00a1', 'reasoning', 'thinking'),
  frame('msg_1', 'text', 'Hello'),
  frame('msg_1', 'text', ', world'),
  frame('resp_1', 'tool_calls', [
    { function: { arguments: '', name: 'readFile' }, id: 'call_1', index: 0, type: 'function' },
  ]),
  frame('resp_1', 'tool_calls', [
    { function: { arguments: '{"path":' }, id: 'call_1', index: 0, type: 'function' },
  ]),
  frame('resp_1', 'tool_calls', [
    { function: { arguments: '"a.md"}' }, id: 'call_1', index: 0, type: 'function' },
  ]),
  frame('resp_1', 'usage', { totalInputTokens: 120, totalOutputTokens: 32 }),
  frame('resp_1', 'stop', 'stop'),
].join('');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readReplayCompletion', () => {
  it('aggregates a text/event-stream body instead of parsing it as JSON', async () => {
    const res = new Response(responsesSSE, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    expect(await readReplayCompletion(res)).toEqual({
      content: 'Hello, world',
      error: undefined,
      toolCalls: [{ arguments: '{"path":"a.md"}', name: 'readFile' }],
      usage: { completionTokens: 32, promptTokens: 120 },
    });
  });

  it('recognizes an SSE body even when the content type was dropped', async () => {
    const res = new Response(responsesSSE, { headers: { 'Content-Type': 'text/plain' } });

    expect((await readReplayCompletion(res)).content).toBe('Hello, world');
  });

  it('still reads an OpenAI JSON completion', async () => {
    const res = Response.json({
      choices: [{ message: { content: 'hi', tool_calls: [{ function: { name: 'x' } }] } }],
      usage: { completion_tokens: 2, prompt_tokens: 9 },
    });

    expect(await readReplayCompletion(res)).toEqual({
      content: 'hi',
      toolCalls: [{ arguments: undefined, name: 'x' }],
      usage: { completionTokens: 2, promptTokens: 9 },
    });
  });

  it('reads a Responses API JSON body', async () => {
    const res = Response.json({
      output: [
        { id: 'rs_1', summary: [], type: 'reasoning' },
        { content: [{ text: 'done', type: 'output_text' }], type: 'message' },
        { arguments: '{}', name: 'search', type: 'function_call' },
      ],
      usage: { input_tokens: 10, output_tokens: 3 },
    });

    expect(await readReplayCompletion(res)).toEqual({
      content: 'done',
      toolCalls: [{ arguments: '{}', name: 'search' }],
      usage: { completionTokens: 3, promptTokens: 10 },
    });
  });
});

describe('aggregateSSECompletion', () => {
  it('keeps parallel tool calls apart by id', () => {
    const raw =
      frame('r', 'tool_calls', [{ function: { arguments: '{}', name: 'a' }, id: 'c1', index: 0 }]) +
      frame('r', 'tool_calls', [{ function: { arguments: '{}', name: 'b' }, id: 'c2', index: 0 }]);

    expect(aggregateSSECompletion(raw).toolCalls.map((call) => call.name)).toEqual(['a', 'b']);
  });

  it('reads answer text from multimodal content parts', () => {
    const raw =
      frame('g', 'reasoning_part', { content: 'hmm', inReasoning: true, partType: 'text' }) +
      frame('g', 'content_part', { content: 'Hi ', partType: 'text' }) +
      frame('g', 'content_part', { content: 'there', partType: 'text' });

    expect(aggregateSSECompletion(raw).content).toBe('Hi there');
  });

  it('surfaces a streamed error event', () => {
    const raw = frame('r', 'error', { message: 'upstream 502', type: 'ProviderBizError' });

    expect(aggregateSSECompletion(raw).error).toBe('ProviderBizError: upstream 502');
  });
});

describe('replayFrozenCall with an SSE response', () => {
  it('returns the aggregated completion rather than a JSON parse error', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(responsesSSE, { headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const attempt = await replayFrozenCall({
      call: { messages: [{ content: 'q', role: 'user' }], stepIndex: 38 } as any,
      connection: { headers: {}, serverUrl: 'https://example.test' },
      maxTokens: 32,
      target: { label: 'p/m', model: 'm', provider: 'p' },
    });

    expect(attempt.error).toBeUndefined();
    expect(attempt.content).toBe('Hello, world');
    expect(attempt.toolCalls).toEqual([{ arguments: '{"path":"a.md"}', name: 'readFile' }]);
    expect(attempt.usage).toEqual({ completionTokens: 32, promptTokens: 120 });
  });
});
