import type { Pricing } from 'model-bank';
import type OpenAI from 'openai';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SparkAIStream, transformSparkResponseToStream } from './spark';

describe('SparkAIStream', () => {
  beforeAll(() => {});

  it('should expose missing usage diagnostics when terminal content chunk has no usage', async () => {
    const mockSparkStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'spark-missing-usage',
          object: 'chat.completion.chunk',
          created: 1734395014,
          model: 'max-32k',
          choices: [
            {
              delta: {
                content: 'final text',
                role: 'assistant',
              },
              finish_reason: 'stop',
              index: 0,
            },
          ],
        } as OpenAI.ChatCompletionChunk);
        controller.close();
      },
    });
    const onFinal = vi.fn();

    const protocolStream = SparkAIStream(mockSparkStream, {
      callbacks: { onFinal },
      payload: {
        apiMode: 'chat_completions',
        includeUsageRequested: true,
        model: 'spark-max',
        provider: 'spark',
      },
    });

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: spark-missing-usage\n',
      'event: text\n',
      'data: "final text"\n\n',
    ]);
    expect(onFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'final text',
        usageMissingDiagnostics: expect.objectContaining({
          apiMode: 'chat_completions',
          finishReason: 'stop',
          hasUsageMetadata: false,
          includeUsageRequested: true,
          model: 'spark-max',
          provider: 'spark',
          responseId: 'spark-missing-usage',
          source: 'openai_chat_completions',
          terminalEventType: 'chat.completion.chunk',
        }),
      }),
    );
  });

  it('should preserve reasoning and text from a mixed delta in order', async () => {
    const mockSparkStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'mixed-delta',
          object: 'chat.completion.chunk',
          created: 1734395014,
          model: 'max-32k',
          choices: [
            {
              delta: {
                content: '  text payload  ',
                reasoning_content: '  reasoning payload  ',
                role: 'assistant',
              },
              index: 0,
              finish_reason: null,
            },
          ],
        } as OpenAI.ChatCompletionChunk);
        controller.enqueue({
          id: 'empty-reasoning-control',
          object: 'chat.completion.chunk',
          created: 1734395014,
          model: 'max-32k',
          choices: [
            {
              delta: {
                content: 'control text',
                reasoning_content: '',
                role: 'assistant',
              },
              index: 0,
              finish_reason: null,
            },
          ],
        } as OpenAI.ChatCompletionChunk);
        controller.enqueue({
          id: 'mixed-delta-usage',
          object: 'chat.completion.chunk',
          created: 1734395014,
          model: 'max-32k',
          choices: [
            {
              delta: {
                content: 'usage text',
                reasoning_content: 'usage reasoning',
                role: 'assistant',
              },
              index: 0,
              finish_reason: null,
            },
          ],
          usage: {
            completion_tokens: 3,
            prompt_tokens: 2,
            total_tokens: 5,
          },
        } as OpenAI.ChatCompletionChunk);
        controller.close();
      },
    });

    const protocolStream = SparkAIStream(mockSparkStream);
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: mixed-delta\n',
      'event: reasoning\n',
      'data: "  reasoning payload  "\n\n',
      'id: mixed-delta\n',
      'event: text\n',
      'data: "  text payload  "\n\n',
      'id: empty-reasoning-control\n',
      'event: text\n',
      'data: "control text"\n\n',
      'id: mixed-delta-usage\n',
      'event: reasoning\n',
      'data: "usage reasoning"\n\n',
      'id: mixed-delta-usage\n',
      'event: text\n',
      'data: "usage text"\n\n',
      'id: mixed-delta-usage\n',
      'event: usage\n',
      expect.stringContaining('"totalTokens":5'),
    ]);
  });

  it('should preserve terminal reasoning, text, usage, and diagnostics', async () => {
    const mockSparkStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'terminal-mixed-delta',
          object: 'chat.completion.chunk',
          created: 1734395014,
          model: 'max-32k',
          choices: [
            {
              delta: {
                content: '  terminal text  ',
                reasoning_content: '  terminal reasoning  ',
                role: 'assistant',
              },
              finish_reason: 'stop',
              index: 0,
            },
          ],
          usage: {
            completion_tokens: 3,
            prompt_tokens: 2,
            total_tokens: 5,
          },
        } as OpenAI.ChatCompletionChunk);
        controller.close();
      },
    });
    const onFinal = vi.fn();

    const protocolStream = SparkAIStream(mockSparkStream, {
      callbacks: { onFinal },
      payload: {
        apiMode: 'chat_completions',
        includeUsageRequested: true,
        model: 'spark-max',
        provider: 'spark',
      },
    });
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks.filter((chunk) => chunk.startsWith('event: '))).toEqual([
      'event: reasoning\n',
      'event: text\n',
      'event: usage\n',
    ]);
    expect(chunks.slice(0, 6)).toEqual([
      'id: terminal-mixed-delta\n',
      'event: reasoning\n',
      'data: "  terminal reasoning  "\n\n',
      'id: terminal-mixed-delta\n',
      'event: text\n',
      'data: "  terminal text  "\n\n',
    ]);
    expect(chunks[6]).toBe('id: terminal-mixed-delta\n');
    expect(chunks[8]).toContain('"totalTokens":5');
    expect(onFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '  terminal text  ',
        usage: expect.objectContaining({
          inputTextTokens: 2,
          outputTextTokens: 3,
          totalTokens: 5,
        }),
      }),
    );
    expect(onFinal).not.toHaveBeenCalledWith(
      expect.objectContaining({ usageMissingDiagnostics: expect.anything() }),
    );
  });

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
      `data: [{"function":{"arguments":"{\\"city\\":\\"Shanghai\\"}","name":"realtime-weather____fetchCurrentWeather"},"id":"call_1","index":0,"type":"function"}]\n\n`,
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

  it('should enrich usage cost when pricing payload is provided', async () => {
    const pricing = {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    } satisfies Pricing;
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [],
          created: 1734395014,
          id: 'usage-cost-id',
          model: 'spark-test-model',
          object: 'chat.completion.chunk',
          usage: {
            completion_tokens: 500_000,
            prompt_tokens: 1_000_000,
            total_tokens: 1_500_000,
          },
        } as unknown as OpenAI.ChatCompletionChunk);
        controller.close();
      },
    });
    const onFinalMock = vi.fn();

    const protocolStream = SparkAIStream(mockStream, {
      callbacks: { onFinal: onFinalMock },
      payload: { pricing },
    });
    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks.join('')).toContain('"cost":2');
    expect(onFinalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          cost: 2,
        }),
      }),
    );
  });
});
