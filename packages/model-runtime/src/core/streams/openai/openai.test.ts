import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../../types/error';
import { FIRST_CHUNK_ERROR_KEY } from '../protocol';
import { OpenAIStream } from './openai';

describe('OpenAIStream', () => {
  it('should transform OpenAI stream to protocol stream', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: { content: 'Hello' },
              index: 0,
            },
          ],
          id: '1',
        });
        controller.enqueue({
          choices: [
            {
              delta: { content: ' world!' },
              index: 1,
            },
          ],
          id: '1',
        });
        controller.enqueue({
          choices: [
            {
              delta: null,
              finish_reason: 'stop',
              index: 2,
            },
          ],
          id: '1',
        });

        controller.close();
      },
    });

    const onStartMock = vi.fn();
    const onTextMock = vi.fn();
    const onCompletionMock = vi.fn();

    const protocolStream = OpenAIStream(mockOpenAIStream, {
      callbacks: {
        onStart: onStartMock,
        onText: onTextMock,
        onCompletion: onCompletionMock,
      },
    });

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: 1\n',
      'event: text\n',
      `data: "Hello"\n\n`,
      'id: 1\n',
      'event: text\n',
      `data: " world!"\n\n`,
      'id: 1\n',
      'event: stop\n',
      `data: "stop"\n\n`,
    ]);

    expect(onStartMock).toHaveBeenCalledTimes(1);
    expect(onTextMock).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onTextMock).toHaveBeenNthCalledWith(2, ' world!');
    expect(onCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('should handle empty stream', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([]);
  });

  it('should handle delta content null', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: { content: null },
              index: 0,
            },
          ],
          id: '3',
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(['id: 3\n', 'event: data\n', `data: {"content":null}\n\n`]);
  });

  it('should handle content with finish_reason', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: '123',
          model: 'deepl',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Introduce yourself.' },
              finish_reason: 'stop',
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      ['id: 123', 'event: text', `data: "Introduce yourself."\n`].map((i) => `${i}\n`),
    );
  });

  it('should emit base64_image and strip markdown data:image from text', async () => {
    const data = [
      {
        id: 'img-1',
        choices: [{ index: 0, delta: { role: 'assistant', content: '这是一张图片： ' } }],
      },
      {
        id: 'img-1',
        choices: [
          {
            index: 0,
            delta: {
              content:
                '![image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAAB3D1E1AA==)',
            },
          },
        ],
      },
      { id: 'img-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];

    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        data.forEach((c) => controller.enqueue(c));
        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: img-1',
        'event: text',
        `data: "这是一张图片： "\n`,
        'id: img-1',
        'event: base64_image',
        `data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAAB3D1E1AA=="\n`,
        'id: img-1',
        'event: stop',
        `data: "stop"\n`,
      ].map((i) => `${i}\n`),
    );
  });

  it('should handle content with tool_calls but is an empty object', async () => {
    // data: {"id":"chatcmpl-A7pokGUqSov0JuMkhiHhWU9GRtAgJ", "object":"chat.completion.chunk", "created":1726430846, "model":"gpt-4o-2024-05-13", "choices":[{"index":0, "delta":{"content":" today", "role":"", "tool_calls":[]}, "finish_reason":"", "logprobs":""}], "prompt_annotations":[{"prompt_index":0, "content_filter_results":null}]}
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              index: 0,
              delta: {
                content: 'Some contents',
                role: '',
                tool_calls: [],
              },
              finish_reason: '',
              logprobs: '',
            },
          ],
          id: '456',
        });

        controller.close();
      },
    });

    const onToolCallMock = vi.fn();

    const protocolStream = OpenAIStream(mockOpenAIStream, {
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

    expect(chunks).toEqual(
      ['id: 456', 'event: text', `data: "Some contents"\n`].map((i) => `${i}\n`),
    );
  });

  it('should handle other delta data', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: { custom_field: 'custom_value' },
              index: 0,
            },
          ],
          id: '4',
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: 4\n',
      'event: data\n',
      `data: {"delta":{"custom_field":"custom_value"},"id":"4","index":0}\n\n`,
    ]);
  });

  it('should emit usage when choices are missing but usage exists', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: '99',
          usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
            prompt_cache_miss_tokens: 1,
          },
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: 99\n',
      'event: usage\n',
      `data: {"inputCacheMissTokens":1,"inputTextTokens":1,"outputTextTokens":2,"totalInputTokens":1,"totalOutputTokens":2,"totalTokens":3}\n\n`,
    ]);
  });

  it('should handle error when there is not correct error', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: { content: 'Hello' },
              index: 0,
            },
          ],
          id: '1',
        });
        controller.enqueue({
          id: '1',
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      ['id: 1', 'event: text', `data: "Hello"\n`, 'id: 1', 'event: data', `data: {"id":"1"}\n`].map(
        (i) => `${i}\n`,
      ),
    );
  });

  it('should handle FIRST_CHUNK_ERROR_KEY', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          [FIRST_CHUNK_ERROR_KEY]: true,
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: 'Test error',
        });
        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: first_chunk_error\n',
      'event: error\n',
      `data: {"body":{"errorType":"ProviderBizError","message":"Test error"},"message":"Test error","type":"ProviderBizError"}\n\n`,
    ]);
  });

  it('should use bizErrorTypeTransformer', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          '%FIRST_CHUNK_ERROR%: ' +
            JSON.stringify({ message: 'Custom error', name: 'CustomError' }),
        );
        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream, {
      bizErrorTypeTransformer: () => AgentRuntimeErrorType.PermissionDenied,
      payload: {
        provider: 'grok',
      },
    });

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: first_chunk_error\n',
      'event: error\n',
      `data: {"body":{"message":"Custom error","errorType":"PermissionDenied","provider":"grok"},"message":"Custom error","type":"PermissionDenied"}\n\n`,
    ]);
  });

  describe('token usage', () => {
    it('should streaming token usage', async () => {
      const data = [
        {
          id: 'chatcmpl-B7CcnaeK3jqWBMOhxg7SSKFwlk7dC',
          object: 'chat.completion.chunk',
          created: 1741056525,
          model: 'gpt-4o-mini-2024-07-18',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' } }],
          service_tier: 'default',
          system_fingerprint: 'fp_06737a9306',
        },
        {
          id: 'chatcmpl-B7CcnaeK3jqWBMOhxg7SSKFwlk7dC',
          object: 'chat.completion.chunk',
          created: 1741056525,
          model: 'gpt-4o-mini-2024-07-18',
          choices: [{ index: 0, delta: { content: '你好！' } }],
          service_tier: 'default',
          system_fingerprint: 'fp_06737a9306',
        },
        {
          id: 'chatcmpl-B7CcnaeK3jqWBMOhxg7SSKFwlk7dC',
          object: 'chat.completion.chunk',
          created: 1741056525,
          model: 'gpt-4o-mini-2024-07-18',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          service_tier: 'default',
          system_fingerprint: 'fp_06737a9306',
        },
        {
          id: 'chatcmpl-B7CcnaeK3jqWBMOhxg7SSKFwlk7dC',
          object: 'chat.completion.chunk',
          created: 1741056525,
          model: 'gpt-4o-mini-2024-07-18',
          choices: [],
          service_tier: 'default',
          system_fingerprint: 'fp_06737a9306',
          usage: {
            prompt_tokens: 1646,
            completion_tokens: 11,
            total_tokens: 1657,
            prompt_tokens_details: { audio_tokens: 0, cached_tokens: 0 },
            completion_tokens_details: {
              accepted_prediction_tokens: 0,
              audio_tokens: 0,
              reasoning_tokens: 0,
              rejected_prediction_tokens: 0,
            },
          },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chatcmpl-B7CcnaeK3jqWBMOhxg7SSKFwlk7dC',
          'event: text',
          `data: ""\n`,
          'id: chatcmpl-B7CcnaeK3jqWBMOhxg7SSKFwlk7dC',
          'event: text',
          `data: "你好！"\n`,
          'id: chatcmpl-B7CcnaeK3jqWBMOhxg7SSKFwlk7dC',
          'event: stop',
          `data: "stop"\n`,
          'id: chatcmpl-B7CcnaeK3jqWBMOhxg7SSKFwlk7dC',
          'event: usage',
          `data: {"inputCacheMissTokens":1646,"inputTextTokens":1646,"outputTextTokens":11,"totalInputTokens":1646,"totalOutputTokens":11,"totalTokens":1657}\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should streaming litellm token usage', async () => {
      const data = [
        {
          id: 'chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          created: 1741188058,
          model: 'gpt-4o-mini',
          object: 'chat.completion.chunk',
          system_fingerprint: 'fp_06737a9306',
          choices: [{ index: 0, delta: { content: ' #' } }],
          stream_options: { include_usage: true },
        },
        {
          id: 'chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          created: 1741188068,
          model: 'gpt-4o-mini',
          object: 'chat.completion.chunk',
          system_fingerprint: 'fp_06737a9306',
          choices: [{ index: 0, delta: { content: '.' } }],
          stream_options: { include_usage: true },
        },
        {
          id: 'chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          created: 1741188068,
          model: 'gpt-4o-mini',
          object: 'chat.completion.chunk',
          system_fingerprint: 'fp_06737a9306',
          choices: [{ finish_reason: 'stop', index: 0, delta: {} }],
          stream_options: { include_usage: true },
        },
        {
          id: 'chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          created: 1741188068,
          model: 'gpt-4o-mini',
          object: 'chat.completion.chunk',
          system_fingerprint: 'fp_06737a9306',
          choices: [{ index: 0, delta: {} }],
          stream_options: { include_usage: true },
        },
        {
          id: 'chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          created: 1741188068,
          model: 'gpt-4o-mini',
          object: 'chat.completion.chunk',
          system_fingerprint: 'fp_06737a9306',
          choices: [{ index: 0, delta: {} }],
          stream_options: { include_usage: true },
          usage: {
            completion_tokens: 1720,
            prompt_tokens: 1797,
            total_tokens: 3517,
            completion_tokens_details: {
              accepted_prediction_tokens: 0,
              audio_tokens: 0,
              reasoning_tokens: 0,
              rejected_prediction_tokens: 0,
            },
            prompt_tokens_details: { audio_tokens: 0, cached_tokens: 0 },
          },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          'event: text',
          `data: " #"\n`,
          'id: chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          'event: text',
          `data: "."\n`,
          'id: chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          'event: stop',
          `data: "stop"\n`,
          'id: chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          'event: data',
          `data: {"delta":{},"id":"chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5","index":0}\n`,
          'id: chatcmpl-c1f6a6a6-fcf8-463a-96bf-cf634d3e98a5',
          'event: usage',
          `data: {"inputCacheMissTokens":1797,"inputTextTokens":1797,"outputTextTokens":1720,"totalInputTokens":1797,"totalOutputTokens":1720,"totalTokens":3517}\n`,
        ].map((i) => `${i}\n`),
      );
    });
  });

  describe('Tools Calling', () => {
    it('should handle OpenAI official tool calls', async () => {
      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      function: { name: 'tool1', arguments: '{}' },
                      id: 'call_1',
                      index: 0,
                      type: 'function',
                    },
                    {
                      function: { name: 'tool2', arguments: '{}' },
                      id: 'call_2',
                      index: 1,
                    },
                  ],
                },
                index: 0,
              },
            ],
            id: '2',
          });

          controller.close();
        },
      });

      const onToolCallMock = vi.fn();

      const protocolStream = OpenAIStream(mockOpenAIStream, {
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
        'id: 2\n',
        'event: tool_calls\n',
        `data: [{"function":{"arguments":"{}","name":"tool1"},"id":"call_1","index":0,"type":"function"},{"function":{"arguments":"{}","name":"tool2"},"id":"call_2","index":1,"type":"function"}]\n\n`,
      ]);

      expect(onToolCallMock).toHaveBeenCalledTimes(1);
    });

    it('should handle tool calls without index and type like mistral and minimax', async () => {
      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      function: { name: 'tool1', arguments: '{}' },
                      id: 'call_1',
                    },
                    {
                      function: { name: 'tool2', arguments: '{}' },
                      id: 'call_2',
                    },
                  ],
                },
                index: 0,
              },
            ],
            id: '5',
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual([
        'id: 5\n',
        'event: tool_calls\n',
        `data: [{"function":{"arguments":"{}","name":"tool1"},"id":"call_1","index":0,"type":"function"},{"function":{"arguments":"{}","name":"tool2"},"id":"call_2","index":1,"type":"function"}]\n\n`,
      ]);
    });

    it('should handle LiteLLM tools Calling', async () => {
      const streamData = [
        {
          id: '1',
          choices: [{ index: 0, delta: { content: '为了获取杭州的天气情况', role: 'assistant' } }],
        },
        {
          id: '1',
          choices: [{ index: 0, delta: { content: '让我为您查询一下。' } }],
        },
        {
          id: '1',
          choices: [
            {
              index: 0,
              delta: {
                content: '',
                tool_calls: [
                  {
                    id: 'toolu_01VQtK4W9kqxGGLHgsPPxiBj',
                    function: { arguments: '', name: 'realtime-weather____fetchCurrentWeather' },
                    type: 'function',
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
        {
          id: '1',
          choices: [
            {
              index: 0,
              delta: {
                content: '',
                tool_calls: [
                  {
                    function: { arguments: '{"city": "\u676d\u5dde"}' },
                    type: 'function',
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
        {
          id: '1',
          choices: [{ finish_reason: 'tool_calls', index: 0, delta: {} }],
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          streamData.forEach((data) => {
            controller.enqueue(data);
          });

          controller.close();
        },
      });

      const onToolCallMock = vi.fn();

      const protocolStream = OpenAIStream(mockOpenAIStream, {
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

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: text',
          `data: "为了获取杭州的天气情况"\n`,
          'id: 1',
          'event: text',
          `data: "让我为您查询一下。"\n`,
          'id: 1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"","name":"realtime-weather____fetchCurrentWeather"},"id":"toolu_01VQtK4W9kqxGGLHgsPPxiBj","index":0,"type":"function"}]\n`,
          'id: 1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"city\\": \\"杭州\\"}","name":null},"id":"toolu_01VQtK4W9kqxGGLHgsPPxiBj","index":0,"type":"function"}]\n`,
          'id: 1',
          'event: stop',
          `data: "tool_calls"\n`,
        ].map((i) => `${i}\n`),
      );

      expect(onToolCallMock).toHaveBeenCalledTimes(2);
    });

    it('should handle tool calls without id using streamContext', async () => {
      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          // First chunk with id to initialize streamContext.tool
          controller.enqueue({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      function: { name: 'tool1', arguments: '{' },
                      id: 'call_123',
                      index: 0,
                      type: 'function',
                    },
                  ],
                },
                index: 0,
              },
            ],
            id: 'stream-context-1',
          });
          // Second chunk without id, should use streamContext.tool.id
          controller.enqueue({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      function: { arguments: '}' },
                      index: 0,
                    },
                  ],
                },
                index: 0,
              },
            ],
            id: 'stream-context-1',
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual([
        'id: stream-context-1\n',
        'event: tool_calls\n',
        `data: [{"function":{"arguments":"{","name":"tool1"},"id":"call_123","index":0,"type":"function"}]\n\n`,
        'id: stream-context-1\n',
        'event: tool_calls\n',
        `data: [{"function":{"arguments":"}","name":null},"id":"call_123","index":0,"type":"function"}]\n\n`,
      ]);
    });

    it('should handle vLLM tools Calling', async () => {
      const streamData = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1745385918,
          model: 'Qwen/Qwen2.5-7B-Instruct-1M',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'chatcmpl-tool-ca9bc139abc449388c6457d5decc949b',
                    type: 'function',
                    index: 0,
                    function: { name: 'BingBS____BingSearch' },
                  },
                ],
              },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1745385918,
          model: 'Qwen/Qwen2.5-7B-Instruct-1M',
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '{"query": "' } }] },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1745385918,
          model: 'Qwen/Qwen2.5-7B-Instruct-1M',
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '最近' } }] },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1745385918,
          model: 'Qwen/Qwen2.5-7B-Instruct-1M',
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '新闻' } }] },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1745385918,
          model: 'Qwen/Qwen2.5-7B-Instruct-1M',
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '"}' } }] },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1745385918,
          model: 'Qwen/Qwen2.5-7B-Instruct-1M',
          choices: [
            {
              index: 0,
              delta: { content: '' },
              logprobs: null,
              finish_reason: 'tool_calls',
              stop_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1745385918,
          model: 'Qwen/Qwen2.5-7B-Instruct-1M',
          choices: [],
          usage: { prompt_tokens: 333, total_tokens: 359, completion_tokens: 26 },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          streamData.forEach((data) => {
            controller.enqueue(data);
          });

          controller.close();
        },
      });

      const onToolCallMock = vi.fn();

      const protocolStream = OpenAIStream(mockOpenAIStream, {
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

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"","name":"BingBS____BingSearch"},"id":"chatcmpl-tool-ca9bc139abc449388c6457d5decc949b","index":0,"type":"function"}]\n`,
          'id: 1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"query\\": \\"","name":null},"id":"chatcmpl-tool-ca9bc139abc449388c6457d5decc949b","index":0,"type":"function"}]\n`,
          'id: 1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"最近","name":null},"id":"chatcmpl-tool-ca9bc139abc449388c6457d5decc949b","index":0,"type":"function"}]\n`,
          'id: 1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"新闻","name":null},"id":"chatcmpl-tool-ca9bc139abc449388c6457d5decc949b","index":0,"type":"function"}]\n`,
          'id: 1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"\\"}","name":null},"id":"chatcmpl-tool-ca9bc139abc449388c6457d5decc949b","index":0,"type":"function"}]\n`,
          'id: 1',
          'event: stop',
          `data: "tool_calls"\n`,
          'id: 1',
          'event: usage',
          `data: {"inputTextTokens":333,"outputTextTokens":26,"totalInputTokens":333,"totalOutputTokens":26,"totalTokens":359}\n`,
        ].map((i) => `${i}\n`),
      );
    });
  });

  describe('Reasoning', () => {
    it('should handle <think></think> tags in streaming content', async () => {
      const data = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '<think>' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '这是一个思考过程' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '，需要仔细分析问题。' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '</think>' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '根据分析，我的答案是：' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '这是最终答案。' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '' },
              logprobs: null,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 50,
            total_tokens: 60,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 20 },
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 10,
          },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });
          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);
      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: reasoning',
          `data: ""\n`,
          'id: 1',
          'event: reasoning',
          `data: "这是一个思考过程"\n`,
          'id: 1',
          'event: reasoning',
          `data: "，需要仔细分析问题。"\n`,
          'id: 1',
          'event: text',
          `data: ""\n`,
          'id: 1',
          'event: text',
          `data: "根据分析，我的答案是："\n`,
          'id: 1',
          'event: text',
          `data: "这是最终答案。"\n`,
          'id: 1',
          'event: usage',
          `data: {"inputCacheMissTokens":10,"inputTextTokens":10,"outputReasoningTokens":20,"outputTextTokens":30,"totalInputTokens":10,"totalOutputTokens":50,"totalTokens":60}\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should split reasoning and text when </think> and content are in the same chunk', async () => {
      const data = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'minimax-m2',
          choices: [
            {
              index: 0,
              delta: { content: '<think>思考开始' },
              finish_reason: null,
              logprobs: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563071,
          model: 'minimax-m2',
          choices: [
            {
              index: 0,
              delta: { content: '思考进行中' },
              finish_reason: null,
              logprobs: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563072,
          model: 'minimax-m2',
          choices: [
            {
              index: 0,
              delta: { content: '思考结束</think>这是最终回答' },
              finish_reason: null,
              logprobs: null,
            },
          ],
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);
      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: reasoning',
          `data: "思考开始"\n`,
          'id: 1',
          'event: reasoning',
          `data: "思考进行中"\n`,
          'id: 1',
          'event: reasoning',
          `data: "思考结束"\n`,
          'id: 1',
          'event: text',
          `data: "这是最终回答"\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle reasoning event in official DeepSeek api', async () => {
      const data = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: null, reasoning_content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: null, reasoning_content: '您好' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: null, reasoning_content: '！' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '你好', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '很高兴', reasoning_cont: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '为您', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '提供', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '帮助。', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: null },
              logprobs: null,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 6,
            completion_tokens: 104,
            total_tokens: 110,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 70 },
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 6,
          },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: reasoning',
          `data: ""\n`,
          'id: 1',
          'event: reasoning',
          `data: "您好"\n`,
          'id: 1',
          'event: reasoning',
          `data: "！"\n`,
          'id: 1',
          'event: text',
          `data: "你好"\n`,
          'id: 1',
          'event: text',
          `data: "很高兴"\n`,
          'id: 1',
          'event: text',
          `data: "为您"\n`,
          'id: 1',
          'event: text',
          `data: "提供"\n`,
          'id: 1',
          'event: text',
          `data: "帮助。"\n`,
          'id: 1',
          'event: usage',
          `data: {"inputCacheMissTokens":6,"inputTextTokens":6,"outputReasoningTokens":70,"outputTextTokens":34,"totalInputTokens":6,"totalOutputTokens":104,"totalTokens":110}\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle reasoning event in aliyun bailian api', async () => {
      const data = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '', reasoning_content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: '您好' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: '！' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '你好', reasoning_content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '很高兴', reasoning_cont: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '为您', reasoning_content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '提供', reasoning_content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '帮助。', reasoning_content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: '' },
              logprobs: null,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 6,
            completion_tokens: 104,
            total_tokens: 110,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 70 },
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 6,
          },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: reasoning',
          `data: ""\n`,
          'id: 1',
          'event: reasoning',
          `data: "您好"\n`,
          'id: 1',
          'event: reasoning',
          `data: "！"\n`,
          'id: 1',
          'event: reasoning',
          `data: ""\n`,
          'id: 1',
          'event: text',
          `data: "你好"\n`,
          'id: 1',
          'event: text',
          `data: "很高兴"\n`,
          'id: 1',
          'event: text',
          `data: "为您"\n`,
          'id: 1',
          'event: text',
          `data: "提供"\n`,
          'id: 1',
          'event: text',
          `data: "帮助。"\n`,
          'id: 1',
          'event: usage',
          `data: {"inputCacheMissTokens":6,"inputTextTokens":6,"outputReasoningTokens":70,"outputTextTokens":34,"totalInputTokens":6,"totalOutputTokens":104,"totalTokens":110}\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle reasoning in litellm', async () => {
      const data = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', reasoning_content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { reasoning_content: '您好' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { reasoning_content: '！' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '你好', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '很高兴', reasoning_cont: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '为您', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '提供', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '帮助。', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: null },
              logprobs: null,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 6,
            completion_tokens: 104,
            total_tokens: 110,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 70 },
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 6,
          },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: reasoning',
          `data: ""\n`,
          'id: 1',
          'event: reasoning',
          `data: "您好"\n`,
          'id: 1',
          'event: reasoning',
          `data: "！"\n`,
          'id: 1',
          'event: text',
          `data: "你好"\n`,
          'id: 1',
          'event: text',
          `data: "很高兴"\n`,
          'id: 1',
          'event: text',
          `data: "为您"\n`,
          'id: 1',
          'event: text',
          `data: "提供"\n`,
          'id: 1',
          'event: text',
          `data: "帮助。"\n`,
          'id: 1',
          'event: usage',
          `data: {"inputCacheMissTokens":6,"inputTextTokens":6,"outputReasoningTokens":70,"outputTextTokens":34,"totalInputTokens":6,"totalOutputTokens":104,"totalTokens":110}\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle reasoning in siliconflow', async () => {
      const data = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', reasoning_content: '', content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { reasoning_content: '您好', content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { reasoning_content: '！', content: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '你好', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '很高兴', reasoning_cont: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '为您', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '提供', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '帮助。', reasoning_content: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: null },
              logprobs: null,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 6,
            completion_tokens: 104,
            total_tokens: 110,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 70 },
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 6,
          },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: reasoning',
          `data: ""\n`,
          'id: 1',
          'event: reasoning',
          `data: "您好"\n`,
          'id: 1',
          'event: reasoning',
          `data: "！"\n`,
          'id: 1',
          'event: text',
          `data: "你好"\n`,
          'id: 1',
          'event: text',
          `data: "很高兴"\n`,
          'id: 1',
          'event: text',
          `data: "为您"\n`,
          'id: 1',
          'event: text',
          `data: "提供"\n`,
          'id: 1',
          'event: text',
          `data: "帮助。"\n`,
          'id: 1',
          'event: usage',
          `data: {"inputCacheMissTokens":6,"inputTextTokens":6,"outputReasoningTokens":70,"outputTextTokens":34,"totalInputTokens":6,"totalOutputTokens":104,"totalTokens":110}\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle reasoning key from OpenRouter response', async () => {
      const data = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', reasoning: '' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { reasoning: '您好' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { reasoning: '！' },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '你好', reasoning: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '很高兴', reasoning: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '为您', reasoning: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '提供', reasoning: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '帮助。', reasoning: null },
              logprobs: null,
              finish_reason: null,
            },
          ],
        },
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1737563070,
          model: 'deepseek-reasoner',
          system_fingerprint: 'fp_1c5d8833bc',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning: null },
              logprobs: null,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 6,
            completion_tokens: 104,
            total_tokens: 110,
            prompt_tokens_details: { cached_tokens: 0 },
            completion_tokens_details: { reasoning_tokens: 70 },
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 6,
          },
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: reasoning',
          `data: ""\n`,
          'id: 1',
          'event: reasoning',
          `data: "您好"\n`,
          'id: 1',
          'event: reasoning',
          `data: "！"\n`,
          'id: 1',
          'event: text',
          `data: "你好"\n`,
          'id: 1',
          'event: text',
          `data: "很高兴"\n`,
          'id: 1',
          'event: text',
          `data: "为您"\n`,
          'id: 1',
          'event: text',
          `data: "提供"\n`,
          'id: 1',
          'event: text',
          `data: "帮助。"\n`,
          'id: 1',
          'event: usage',
          `data: {"inputCacheMissTokens":6,"inputTextTokens":6,"outputReasoningTokens":70,"outputTextTokens":34,"totalInputTokens":6,"totalOutputTokens":104,"totalTokens":110}\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle claude reasoning in litellm openai mode', async () => {
      const data = [
        {
          id: '1',
          created: 1740505568,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {
                thinking_blocks: [
                  { type: 'thinking', thinking: '我需要找94的所有质', ignature_delta: null },
                ],
                reasoning_content: '我需要找出394的所有质',
                content: '',
                role: 'assistant',
              },
            },
          ],
          thinking_blocks: [
            { type: 'thinking', thinking: '我需要找94的所有质', signature_delta: null },
          ],
        },
        {
          id: '1',
          created: 1740505569,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {
                thinking_blocks: [
                  { type: 'thinking', thinking: '因数。\n质因数是', signature_delta: null },
                ],
                reasoning_content: '因数。\n\n质因数是',
                content: '',
              },
            },
          ],
          thinking_blocks: [
            { type: 'thinking', thinking: '因数。\n\n质因数是', signature_delta: null },
          ],
        },
        {
          id: '1',
          created: 1740505569,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {
                thinking_blocks: [
                  { type: 'thinking', thinking: '÷ 2 = 197', signature_delta: null },
                ],
                reasoning_content: '÷ 2 = 197',
                content: '',
              },
            },
          ],
          thinking_blocks: [{ type: 'thinking', thinking: '÷ 2 = 197', signature_delta: null }],
        },
        {
          id: '1',
          created: 1740505571,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {
                thinking_blocks: [
                  { type: 'thinking', thinking: '197。n394 = 2 ', signature_delta: null },
                ],
                reasoning_content: '197。\n394 = 2 ',
                content: '',
              },
            },
          ],
          thinking_blocks: [{ type: 'thinking', thinking: '\n394 = 2 ', signature_delta: null }],
        },
        {
          id: '1',
          created: 1740505571,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {
                content: '',
                tool_calls: [{ function: { arguments: '{}' }, type: 'function', index: -1 }],
              },
            },
          ],
        },
        {
          id: '1',
          created: 1740505571,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: '要找出394的质因数，我需要将' } }],
        },
        {
          id: '1',
          created: 1740505571,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: '394分解为质数的乘积' } }],
        },
        {
          id: '1',
          created: 1740505573,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: '2和197。' } }],
        },
        {
          id: '1',
          created: 1740505573,
          model: 'claude-3-7-sonnet-latest',
          object: 'chat.completion.chunk',
          choices: [{ finish_reason: 'stop', index: 0, delta: {} }],
        },
      ];

      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          data.forEach((chunk) => {
            controller.enqueue(chunk);
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: 1',
          'event: reasoning',
          `data: "我需要找出394的所有质"\n`,
          'id: 1',
          'event: reasoning',
          `data: "因数。\\n\\n质因数是"\n`,
          'id: 1',
          'event: reasoning',
          `data: "÷ 2 = 197"\n`,
          'id: 1',
          'event: reasoning',
          `data: "197。\\n394 = 2 "\n`,
          'id: 1',
          'event: text',
          `data: ""\n`,
          'id: 1',
          'event: text',
          `data: "要找出394的质因数，我需要将"\n`,
          'id: 1',
          'event: text',
          `data: "394分解为质数的乘积"\n`,
          'id: 1',
          'event: text',
          `data: "2和197。"\n`,
          'id: 1',
          'event: stop',
          `data: "stop"\n`,
        ].map((i) => `${i}\n`),
      );
    });
  });

  it('should handle base64_image in delta.images (image_url shape)', async () => {
    const base64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: {
                images: [
                  {
                    type: 'image_url',
                    image_url: { url: base64 },
                    index: 0,
                  },
                ],
              },
              index: 0,
            },
          ],
          id: '6',
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(['id: 6\n', 'event: base64_image\n', `data: "${base64}"\n\n`]);
  });

  it('should handle finish_reason with markdown image in content', async () => {
    const base64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAQACAIAAADwf7zUAAAgAElEQVR4nFy9a5okSY4jCFBU3SOr53HdvcZeYW/YVZnhZqpCYn+AVIuZ7PqqKyPczfQhQgIgSOH/+//9PxRVu7QzX5nvqveVP5mv+3rf+XPt985b2NIVgVgK1jr0da7zrAiegWPhPBABLi1GILhCEMkFnCuOFRFxHN/r/CbOym/om/h1X+d1H/v667rP9328r9g3VNblpoXsAwsnTtnWp0kQ40siih6NixuHlN9Rt7ehv1mbW2dkg1ef03J9zQQpQg5yc/XllveG4wa4arKtSr0NwSCdGEJVNeKlkDZMov695YaQ5NVK3fmjn4OrE9N/U04C0EqT/2HCBxrf9pJe1L2nPBjqhKEq1TEi1Q/OXiIq+IrqX2fUb+qF+2kF10k/4ScwIXidU6/T6vGkA/bSR/fZ7Ok8yOd0s+27CnP8PH3cijINdbAcAAAAASUVORK5CYII=';
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'chatcmpl-test',
          choices: [
            {
              index: 0,
              delta: { content: `这有一张图片： ![image](${base64})` },
              finish_reason: 'stop',
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: chatcmpl-test\n',
      'event: text\n',
      `data: "这有一张图片："\n\n`,
      'id: chatcmpl-test\n',
      'event: base64_image\n',
      `data: "${base64}"\n\n`,
    ]);
  });

  it('should handle finish_reason with multiple markdown images in content', async () => {
    const base64_1 = 'data:image/png;base64,first';
    const base64_2 = 'data:image/jpeg;base64,second';
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'chatcmpl-multi',
          choices: [
            {
              index: 0,
              delta: { content: `![img1](${base64_1}) and ![img2](${base64_2})` },
              finish_reason: 'stop',
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: chatcmpl-multi\n',
      'event: text\n',
      `data: "and"\n\n`, // Remove all markdown base64 image segments
      'id: chatcmpl-multi\n',
      'event: base64_image\n',
      `data: "${base64_1}"\n\n`,
      'id: chatcmpl-multi\n',
      'event: base64_image\n',
      `data: "${base64_2}"\n\n`,
    ]);
  });

  it('should handle delta.images with nested image_url.image_url.url structure', async () => {
    const base64 = 'data:image/png;base64,nestedurl';
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: {
                images: [
                  {
                    image_url: { image_url: { url: base64 } },
                  },
                ],
              },
              index: 0,
            },
          ],
          id: 'nested-url',
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(['id: nested-url\n', 'event: base64_image\n', `data: "${base64}"\n\n`]);
  });

  it('should handle delta.images with direct url property', async () => {
    const base64 = 'data:image/png;base64,directurl';
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: {
                images: [{ url: base64 }],
              },
              index: 0,
            },
          ],
          id: 'direct-url',
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(['id: direct-url\n', 'event: base64_image\n', `data: "${base64}"\n\n`]);
  });

  it('should handle delta.images with string format', async () => {
    const base64 = 'data:image/png;base64,stringformat';
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: {
                images: [base64],
              },
              index: 0,
            },
          ],
          id: 'string-img',
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(['id: string-img\n', 'event: base64_image\n', `data: "${base64}"\n\n`]);
  });

  it('should filter out images without valid url', async () => {
    const base64 = 'data:image/png;base64,validurl';
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: {
                images: [{ invalid: 'data' }, { url: base64 }, null],
              },
              index: 0,
            },
          ],
          id: 'filtered-images',
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: filtered-images\n',
      'event: base64_image\n',
      `data: "${base64}"\n\n`,
    ]);
  });

  it('should ignore content when role is tool in finish_reason', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'minimax-tool-role',
          choices: [
            {
              index: 0,
              delta: { content: 'should be ignored', role: 'tool' },
              finish_reason: 'stop',
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(['id: minimax-tool-role\n', 'event: text\n', `data: null\n\n`]);
  });

  it('should handle OpenAI Search Preview annotations in finish_reason', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'openai-search',
          choices: [
            {
              index: 0,
              delta: {
                annotations: [
                  {
                    type: 'url_citation',
                    url_citation: {
                      url: 'https://example.com',
                      title: 'Example',
                      start_index: 0,
                      end_index: 10,
                    },
                  },
                ],
              },
              finish_reason: 'stop',
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: openai-search\n',
      'event: grounding\n',
      `data: {"citations":[{"title":"Example","url":"https://example.com"}]}\n\n`,
    ]);
  });

  it('should handle MiniMax messages with annotations in finish_reason', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'minimax-messages',
          choices: [
            {
              index: 0,
              messages: [
                { content: '', role: 'user' },
                { content: '', role: 'assistant' },
                { content: '', role: 'tool' },
                {
                  content: '',
                  role: 'assistant',
                  annotations: [
                    {
                      text: '【5†source】',
                      url: 'https://example.com',
                      quote: 'Example quote',
                    },
                  ],
                },
              ],
              finish_reason: 'tool_calls',
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: minimax-messages\n',
      'event: grounding\n',
      `data: {"citations":[{"title":"https://example.com","url":"https://example.com"}]}\n\n`,
    ]);
  });

  it('should handle xAI citations in finish_reason', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'xai-citations',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant' },
              finish_reason: 'stop',
            },
          ],
          citations: ['https://example1.com', 'https://example2.com'],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: xai-citations\n',
      'event: grounding\n',
      `data: {"citations":[{"title":"https://example1.com","url":"https://example1.com"},{"title":"https://example2.com","url":"https://example2.com"}]}\n\n`,
    ]);
  });

  it('should handle finish_reason with usage', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'finish-usage',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: finish-usage\n',
      'event: usage\n',
      `data: {"inputTextTokens":10,"outputTextTokens":20,"totalInputTokens":10,"totalOutputTokens":20,"totalTokens":30}\n\n`,
    ]);
  });

  it('should handle mistral AI Magistral thinking blocks in content array', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'mistral-thinking',
          choices: [
            {
              index: 0,
              delta: {
                content: [
                  {
                    type: 'thinking',
                    thinking: [
                      { type: 'text', text: 'First thought' },
                      { type: 'text', text: 'Second thought' },
                      { type: 'other', data: 'ignored' },
                    ],
                  },
                  {
                    type: 'thinking',
                    thinking: [{ type: 'text', text: 'Third thought' }],
                  },
                ],
              },
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: mistral-thinking\n',
      'event: reasoning\n',
      `data: "First thoughtSecond thoughtThird thought"\n\n`,
    ]);
  });

  it('should handle empty content and empty reasoning_content (still outputs reasoning)', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'empty-both',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: '' },
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    // When both are empty strings, content becomes null but reasoning_content stays as empty string
    expect(chunks).toEqual(['id: empty-both\n', 'event: reasoning\n', `data: ""\n\n`]);
  });

  it('should handle empty content with non-empty reasoning_content', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'empty-content-with-reasoning',
          choices: [
            {
              index: 0,
              delta: { content: '', reasoning_content: 'some thinking' },
            },
          ],
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: empty-content-with-reasoning\n',
      'event: reasoning\n',
      `data: "some thinking"\n\n`,
    ]);
  });

  it('should handle Gemini empty content with usage', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: 'gemini-usage',
          choices: [
            {
              index: 0,
              delta: { content: '' },
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
          },
        });

        controller.close();
      },
    });

    const protocolStream = OpenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: gemini-usage\n',
      'event: usage\n',
      `data: {"inputTextTokens":5,"outputTextTokens":10,"totalInputTokens":5,"totalOutputTokens":10,"totalTokens":15}\n\n`,
    ]);
  });

  describe('Grounding/Citations', () => {
    it('should handle Perplexity citations', async () => {
      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            id: 'perplexity-1',
            choices: [{ index: 0, delta: { content: 'Here is some info' } }],
            citations: ['https://source1.com', 'https://source2.com'],
          });
          controller.enqueue({
            id: 'perplexity-1',
            choices: [{ index: 0, delta: { content: ' more content' } }],
            citations: ['https://source1.com', 'https://source2.com'],
          });
          controller.enqueue({
            id: 'perplexity-1',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: perplexity-1',
          'event: grounding',
          `data: {"citations":[{"title":"https://source1.com","url":"https://source1.com"},{"title":"https://source2.com","url":"https://source2.com"}]}\n`,
          'id: perplexity-1',
          'event: text',
          `data: "Here is some info"\n`,
          'id: perplexity-1',
          'event: text',
          `data: " more content"\n`,
          'id: perplexity-1',
          'event: stop',
          `data: "stop"\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle Hunyuan search_info.search_results', async () => {
      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            id: 'hunyuan-1',
            choices: [{ index: 0, delta: { content: 'Result' } }],
            search_info: {
              search_results: [
                { title: 'Title 1', url: 'https://result1.com' },
                { title: 'Title 2', link: 'https://result2.com' },
              ],
            },
          });
          controller.enqueue({
            id: 'hunyuan-1',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: hunyuan-1',
          'event: grounding',
          `data: {"citations":[{"title":"Title 1","url":"https://result1.com"},{"title":"Title 2","url":"https://result2.com"}]}\n`,
          'id: hunyuan-1',
          'event: text',
          `data: "Result"\n`,
          'id: hunyuan-1',
          'event: stop',
          `data: "stop"\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle Wenxin search_results', async () => {
      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            id: 'wenxin-1',
            choices: [{ index: 0, delta: { content: 'Content' } }],
            search_results: [{ title: 'Wenxin', url: 'https://wenxin.com' }],
          });
          controller.enqueue({
            id: 'wenxin-1',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: wenxin-1',
          'event: grounding',
          `data: {"citations":[{"title":"Wenxin","url":"https://wenxin.com"}]}\n`,
          'id: wenxin-1',
          'event: text',
          `data: "Content"\n`,
          'id: wenxin-1',
          'event: stop',
          `data: "stop"\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should handle Zhipu web_search and filter empty links', async () => {
      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            id: 'zhipu-1',
            choices: [{ index: 0, delta: { content: 'Search result' } }],
            web_search: [
              { title: 'Valid', url: 'https://valid.com' },
              { title: 'Empty link', link: '' },
              { title: 'No link' },
            ],
          });
          controller.enqueue({
            id: 'zhipu-1',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: zhipu-1',
          'event: grounding',
          `data: {"citations":[{"title":"Valid","url":"https://valid.com"}]}\n`,
          'id: zhipu-1',
          'event: text',
          `data: "Search result"\n`,
          'id: zhipu-1',
          'event: stop',
          `data: "stop"\n`,
        ].map((i) => `${i}\n`),
      );
    });
  });

  describe('Error handling', () => {
    it('should handle stream chunk error and return error chunk', async () => {
      const mockOpenAIStream = new ReadableStream({
        start(controller) {
          // This will cause an error when trying to process
          controller.enqueue({
            id: 'error-chunk',
            choices: [
              {
                index: 0,
                delta: {
                  // This will trigger the error in tool_calls processing
                  tool_calls: [{ function: null }],
                },
              },
            ],
          });

          controller.close();
        },
      });

      const protocolStream = OpenAIStream(mockOpenAIStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks[0]).toBe('id: error-chunk\n');
      expect(chunks[1]).toBe('event: error\n');
      expect(chunks[2]).toContain('StreamChunkError');
      expect(chunks[2]).toContain(
        'chat response streaming chunk parse error, please contact your API Provider to fix it.',
      );
    });
  });
});
