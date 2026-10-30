import type { Stream } from '@anthropic-ai/sdk/streaming';
import { describe, expect, it, vi } from 'vitest';

import { AnthropicStream } from './anthropic';

describe('AnthropicStream interruptions', () => {
  it('should report a stream closed without message_delta / message_stop as interrupted', async () => {
    // A relay closed the connection mid tool call: no `message_delta`, no `message_stop`.
    const mockReadableStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'message_start',
          message: { id: 'msg_1', usage: { input_tokens: 10, output_tokens: 1 } },
        });
        controller.enqueue({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'writeFile', input: {} },
        });
        controller.enqueue({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"content":"Inizia il ' },
        });
        controller.close();
      },
    });

    const onErrorMock = vi.fn();
    const onCompletionMock = vi.fn();
    const protocolStream = AnthropicStream(mockReadableStream, {
      callbacks: { onCompletion: onCompletionMock, onError: onErrorMock },
    });

    const decoder = new TextDecoder();
    const chunks: string[] = [];
    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks.slice(-3)).toEqual([
      'id: msg_1\n',
      'event: error\n',
      expect.stringContaining('"type":"StreamChunkError"'),
    ]);
    expect(onErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Stream ended unexpectedly', type: 'StreamChunkError' }),
    );
    expect(onCompletionMock.mock.calls[0]?.[0].error).toMatchObject({ type: 'StreamChunkError' });
  });
  it('should report a dropped connection as a stream error instead of ending normally', async () => {
    // @ts-ignore
    const mockAnthropicStream: Stream = {
      [Symbol.asyncIterator]() {
        let count = 0;
        return {
          next: async () => {
            if (count++ === 0) {
              return {
                done: false,
                value: { type: 'message_start', message: { id: 'message_1', usage: {} } },
              };
            }
            throw new TypeError('terminated');
          },
        };
      },
    };

    const onErrorMock = vi.fn();
    const onFinalMock = vi.fn();
    const protocolStream = AnthropicStream(mockAnthropicStream, {
      callbacks: { onError: onErrorMock, onFinal: onFinalMock },
      payload: { apiMode: 'messages', model: 'deepseek-flash', provider: 'deepseek' },
    });

    const decoder = new TextDecoder();
    const chunks: string[] = [];
    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toContain('event: error\n');
    expect(onErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'terminated', type: 'ProviderBizError' }),
    );
    expect(onFinalMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: 'terminated' }) }),
    );
  });

  describe('relay-shaped failures', () => {
    const collect = async (events: any[]) => {
      const onCompletion = vi.fn();
      const stream = new ReadableStream({
        start(controller) {
          for (const event of events) controller.enqueue(event);
          controller.close();
        },
      });
      const chunks: string[] = [];
      const reader = AnthropicStream(stream, { callbacks: { onCompletion } }).getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      return { chunks, completion: onCompletion.mock.calls[0]?.[0] };
    };

    it('surfaces an inline error event instead of an empty completion', async () => {
      const { chunks, completion } = await collect([
        {
          message: { id: 'msg_1', usage: { input_tokens: 100, output_tokens: 1 } },
          type: 'message_start',
        },
        { error: { message: 'Overloaded', type: 'overloaded_error' }, type: 'error' },
      ]);

      expect(chunks.some((c) => c.includes('event: error'))).toBe(true);
      expect(completion.error).toMatchObject({ message: 'Overloaded' });
    });

    it('names an OpenAI-format answer on an Anthropic endpoint as a malformed response', async () => {
      const { completion } = await collect([
        {
          choices: [{ delta: { content: 'Hello' }, finish_reason: null, index: 0 }],
          id: 'chatcmpl_1',
          object: 'chat.completion.chunk',
        },
      ]);

      expect(completion.error).toMatchObject({ type: 'UpstreamMalformedResponse' });
    });
  });
});
