import type OpenAI from 'openai';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SparkAIStream, transformSparkResponseToStream } from './spark';

describe('SparkAIStream', () => {
  beforeAll(() => {});

  it('should handle reasoning content in stream', async () => {
    const data = [
      {
        id: 'test-id',
        object: 'chat.completion.chunk',
        created: 1734395014,
        model: 'x1',
        choices: [
          {
            delta: {
              reasoning_content: 'Hello',
              role: 'assistant',
            },
            index: 0,
            finish_reason: null,
          },
        ],
      },
      {
        id: 'test-id',
        object: 'chat.completion.chunk',
        created: 1734395014,
        model: 'x1',
        choices: [
          {
            delta: {
              reasoning_content: ' World',
              role: 'assistant',
            },
            index: 0,
            finish_reason: null,
          },
        ],
      },
    ];

    const mockSparkStream = new ReadableStream({
      start(controller) {
        data.forEach((chunk) => {
          controller.enqueue(chunk);
        });

        controller.close();
      },
    });

    const protocolStream = SparkAIStream(mockSparkStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: test-id\n',
      'event: reasoning\n',
      'data: "Hello"\n\n',
      'id: test-id\n',
      'event: reasoning\n',
      'data: " World"\n\n',
    ]);
  });

  it('should transform non-streaming response to stream', async () => {
    const mockResponse = {
      id: 'cha000ceba6@dx193d200b580b8f3532',
      object: 'chat.completion',
      created: 1734395014,
      model: 'max-32k',
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            refusal: null,
            tool_calls: {
              type: 'function',
              function: {
                arguments: '{"city":"Shanghai"}',
                name: 'realtime-weather____fetchCurrentWeather',
              },
              id: 'call_1',
            },
          },
          index: 0,
          logprobs: null,
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 0,
        total_tokens: 8,
      },
    } as unknown as OpenAI.ChatCompletion;

    const stream = transformSparkResponseToStream(mockResponse);
    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].choices[0].delta.tool_calls).toEqual([
      {
        function: {
          arguments: '{"city":"Shanghai"}',
          name: 'realtime-weather____fetchCurrentWeather',
        },
        id: 'call_1',
        index: 0,
        type: 'function',
      },
    ]);
    expect(chunks[2].choices[0].finish_reason).toBeDefined();
  });

  it('should transform streaming response with tool calls', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'cha000b0bf9@dx193d1ffa61cb894532',
          object: 'chat.completion.chunk',
          created: 1734395014,
          model: 'max-32k',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: '',
                tool_calls: {
                  type: 'function',
                  function: {
                    arguments: '{"city":"Shanghai"}',
                    name: 'realtime-weather____fetchCurrentWeather',
                  },
                  id: 'call_1',
                },
              },
              index: 0,
            },
          ],
        } as unknown as OpenAI.ChatCompletionChunk);
        controller.close();
      },
    });

    const onToolCallMock = vi.fn();

    const protocolStream = SparkAIStream(mockStream, {
      callbacks: {
        onToolsCalling: onToolCallMock,
      },
    });

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: cha000b0bf9@dx193d1ffa61cb894532\n',
      'event: tool_calls\n',
      `data: [{\"function\":{\"arguments\":\"{\\\"city\\\":\\\"Shanghai\\\"}\",\"name\":\"realtime-weather____fetchCurrentWeather\"},\"id\":\"call_1\",\"index\":0,\"type\":\"function\"}]\n\n`,
    ]);

    expect(onToolCallMock).toHaveBeenCalledTimes(1);
  });

  it('should handle text content in stream', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'test-id',
          object: 'chat.completion.chunk',
          created: 1734395014,
          model: 'max-32k',
          choices: [
            {
              delta: {
                content: 'Hello',
                role: 'assistant',
              },
              index: 0,
            },
          ],
        } as OpenAI.ChatCompletionChunk);
        controller.enqueue({
          id: 'test-id',
          object: 'chat.completion.chunk',
          created: 1734395014,
          model: 'max-32k',
          choices: [
            {
              delta: {
                content: ' World',
                role: 'assistant',
              },
              index: 0,
            },
          ],
        } as OpenAI.ChatCompletionChunk);
        controller.close();
      },
    });

    const onTextMock = vi.fn();

    const protocolStream = SparkAIStream(mockStream, {
      callbacks: {
        onText: onTextMock,
      },
    });

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: test-id\n',
      'event: text\n',
      'data: "Hello"\n\n',
      'id: test-id\n',
      'event: text\n',
      'data: " World"\n\n',
    ]);

    expect(onTextMock).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onTextMock).toHaveBeenNthCalledWith(2, ' World');
  });

  it('should handle empty stream', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const protocolStream = SparkAIStream(mockStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([]);
  });
});
