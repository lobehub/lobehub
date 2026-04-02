import type { InvokeModelWithResponseStreamResponse } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it, vi } from 'vitest';

import * as uuidModule from '../../../utils/uuid';
import { AWSBedrockLlamaStream } from './llama';

describe('AWSBedrockLlamaStream', () => {
  it('should transform Bedrock Llama stream to protocol stream', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');
    const mockBedrockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ generation: 'Hello', generation_token_count: 1 });
        controller.enqueue({ generation: ' world!', generation_token_count: 2 });
        controller.enqueue({ stop_reason: 'stop' });
        controller.close();
      },
    });

    const onStartMock = vi.fn();
    const onTextMock = vi.fn();
    const onCompletionMock = vi.fn();

    const protocolStream = AWSBedrockLlamaStream(mockBedrockStream, {
      onStart: onStartMock,
      onText: onTextMock,
      onCompletion: onCompletionMock,
    });

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: chat_1\n',
      'event: text\n',
      `data: "Hello"\n\n`,
      'id: chat_1\n',
      'event: text\n',
      `data: " world!"\n\n`,
      'id: chat_1\n',
      'event: stop\n',
      `data: "finished"\n\n`,
    ]);

    expect(onStartMock).toHaveBeenCalledTimes(1);
    expect(onTextMock).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onTextMock).toHaveBeenNthCalledWith(2, ' world!');
    expect(onCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('should transform Bedrock Llama AsyncIterator to protocol stream', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

    const mockBedrockStream: InvokeModelWithResponseStreamResponse = {
      body: {
        // @ts-ignore
        async *[Symbol.asyncIterator]() {
          yield { generation: 'Hello', generation_token_count: 1 };
          yield { generation: ' world!', generation_token_count: 2 };
          yield { stop_reason: 'stop' };
        },
      },
    };

    const onStartMock = vi.fn();
    const onTextMock = vi.fn();
    const onCompletionMock = vi.fn();

    const protocolStream = AWSBedrockLlamaStream(mockBedrockStream, {
      onStart: onStartMock,
      onText: onTextMock,
      onCompletion: onCompletionMock,
    });

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: chat_1\n',
      'event: text\n',
      `data: "Hello"\n\n`,
      'id: chat_1\n',
      'event: text\n',
      `data: " world!"\n\n`,
      'id: chat_1\n',
      'event: stop\n',
      `data: "finished"\n\n`,
    ]);

    expect(onStartMock).toHaveBeenCalledTimes(1);
    expect(onTextMock).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onTextMock).toHaveBeenNthCalledWith(2, ' world!');
    expect(onCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('should handle Bedrock response with chunk property', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('2');

    const mockBedrockStream: InvokeModelWithResponseStreamResponse = {
      contentType: 'any',
      body: {
        // @ts-ignore
        async *[Symbol.asyncIterator]() {
          yield {
            chunk: {
              bytes: new TextEncoder().encode('{"generation":"Hello","generation_token_count":1}'),
            },
          };
          yield {
            chunk: {
              bytes: new TextEncoder().encode(
                '{"generation":" world!","generation_token_count":2}',
              ),
            },
          };
          yield { chunk: { bytes: new TextEncoder().encode('{"stop_reason":"stop"}') } };
        },
      },
    };

    const onStartMock = vi.fn();
    const onTextMock = vi.fn();
    const onTokenMock = vi.fn();
    const onCompletionMock = vi.fn();

    const protocolStream = AWSBedrockLlamaStream(mockBedrockStream, {
      onStart: onStartMock,
      onText: onTextMock,
      onCompletion: onCompletionMock,
    });

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: chat_2\n',
      'event: text\n',
      `data: "Hello"\n\n`,
      'id: chat_2\n',
      'event: text\n',
      `data: " world!"\n\n`,
      'id: chat_2\n',
      'event: stop\n',
      `data: "finished"\n\n`,
    ]);

    expect(onStartMock).toHaveBeenCalledTimes(1);
    expect(onTextMock).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onTextMock).toHaveBeenNthCalledWith(2, ' world!');
    expect(onCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('should handle JSON split across chunk boundaries (multi-byte UTF-8)', async () => {
    vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('3');

    // Simulate Bedrock splitting a JSON payload mid-emoji. TextDecoder with
    // stream: true buffers the incomplete multi-byte sequence, but the
    // resulting string is still incomplete JSON that fails JSON.parse().
    // Without buffering, the old code would yield the raw string, and
    // downstream transformers that access chunk.generation would get
    // undefined — silently dropping the content.
    const fullJson = '{"generation":"Hello 🌍","generation_token_count":1}';
    const bytes = new TextEncoder().encode(fullJson);

    // Split at byte 23 — inside the 4-byte 🌍 emoji (U+1F30D)
    const chunk1Bytes = bytes.slice(0, 23);
    const chunk2Bytes = bytes.slice(23);

    const mockBedrockStream: InvokeModelWithResponseStreamResponse = {
      body: {
        // @ts-ignore
        async *[Symbol.asyncIterator]() {
          yield { chunk: { bytes: chunk1Bytes } };
          yield { chunk: { bytes: chunk2Bytes } };
          yield {
            chunk: { bytes: new TextEncoder().encode('{"stop_reason":"stop"}') },
          };
        },
      },
    };

    const protocolStream = AWSBedrockLlamaStream(mockBedrockStream, {});

    const decoder = new TextDecoder();
    const chunks: string[] = [];
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    // The split JSON must be reassembled — "Hello 🌍" should appear intact
    expect(chunks).toEqual([
      'id: chat_3\n',
      'event: text\n',
      'data: "Hello 🌍"\n\n',
      'id: chat_3\n',
      'event: stop\n',
      'data: "finished"\n\n',
    ]);
  });

  it('should handle empty stream', async () => {
    const mockBedrockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const protocolStream = AWSBedrockLlamaStream(mockBedrockStream);

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([]);
  });
});
