import type OpenAI from 'openai';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { StreamContext } from './protocol';
import { QwenAIStream, transformQwenStream } from './qwen';

describe('QwenAIStream', () => {
  beforeAll(() => {});

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

    const protocolStream = QwenAIStream(mockOpenAIStream, {
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

  it('should handle tool calls', async () => {
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

    const protocolStream = QwenAIStream(mockOpenAIStream, {
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

  it('should handle empty stream', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const protocolStream = QwenAIStream(mockStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([]);
  });

  it('should handle chunk with no choices', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [],
          id: '1',
        });

        controller.close();
      },
    });

    const protocolStream = QwenAIStream(mockStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(['id: 1\n', 'event: data\n', 'data: {"choices":[],"id":"1"}\n\n']);
  });

  it('should handle vision model stream', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: {
                content: [
                  {
                    text: '图中是一只小狗',
                  },
                ],
              },
            },
          ],
          id: '3',
        });

        /**
         * Just for test against the description of 'output.choices[x].message.content' in [documents](https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-qianwen-vl-plus-api)
         * You're not likely to get image outputs from current versions of vl models.
         */
        controller.enqueue({
          choices: [
            {
              delta: {
                content: [
                  {
                    image: 'https://hello.mock/test.png',
                  },
                ],
              },
            },
          ],
          id: '3',
        });
        controller.close();
      },
    });

    const protocolStream = QwenAIStream(mockStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: 3\n',
      'event: text\n',
      'data: "图中是一只小狗"\n\n',
      'id: 3\n',
      'event: text\n',
      'data: "![image](https://hello.mock/test.png)"\n\n',
    ]);
  });

  it('should delta content null', async () => {
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

    const protocolStream = QwenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(['id: 3\n', 'event: data\n', `data: {"content":null}\n\n`]);
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

    const protocolStream = QwenAIStream(mockOpenAIStream);

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

  it('should handle tool calls without index and type', async () => {
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

    const protocolStream = QwenAIStream(mockOpenAIStream);

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

  // Test case for Qwen models sending tool_calls in two separate chunks:
  // 1. First chunk: {id, name} without arguments
  // 2. Second chunk: {id, arguments} without name
  // This behavior is observed in qwen3-vl-235b-a22b-thinking model
  it('should handle tool calls with name in first chunk and arguments in second chunk (Qwen behavior)', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        // First chunk: has id and name, but no arguments
        controller.enqueue({
          choices: [
            {
              delta: {
                content: null,
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_4bde23783e314f219c6d65',
                    type: 'function',
                    function: { name: 'time____get_current_time____mcp' },
                  },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          id: 'chatcmpl-f574998f-e5b0-9b80-aac5-14b58e6978b5',
        });

        // Second chunk: same id, has arguments but no name
        controller.enqueue({
          choices: [
            {
              delta: {
                content: null,
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_4bde23783e314f219c6d65',
                    type: 'function',
                    function: { arguments: '{"timezone": "Asia/Shanghai"}' },
                  },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          id: 'chatcmpl-f574998f-e5b0-9b80-aac5-14b58e6978b5',
        });

        controller.close();
      },
    });

    const onToolCallMock = vi.fn();

    const protocolStream = QwenAIStream(mockOpenAIStream, {
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

    // First chunk should have name with empty arguments
    // Second chunk should have arguments with null name (same as OpenAI/vLLM behavior)
    expect(chunks).toEqual([
      'id: chatcmpl-f574998f-e5b0-9b80-aac5-14b58e6978b5\n',
      'event: tool_calls\n',
      `data: [{"function":{"arguments":"","name":"time____get_current_time____mcp"},"id":"call_4bde23783e314f219c6d65","index":0,"type":"function"}]\n\n`,
      'id: chatcmpl-f574998f-e5b0-9b80-aac5-14b58e6978b5\n',
      'event: tool_calls\n',
      `data: [{"function":{"arguments":"{\\"timezone\\": \\"Asia/Shanghai\\"}","name":null},"id":"call_4bde23783e314f219c6d65","index":0,"type":"function"}]\n\n`,
    ]);

    expect(onToolCallMock).toHaveBeenCalledTimes(2);
  });

  it('should handle tool calls with only name (no arguments field)', async () => {
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_123',
                    type: 'function',
                    function: { name: 'get_weather' },
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

    const protocolStream = QwenAIStream(mockOpenAIStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    // Should have empty string for arguments, not undefined
    expect(chunks).toEqual([
      'id: 6\n',
      'event: tool_calls\n',
      `data: [{"function":{"arguments":"","name":"get_weather"},"id":"call_123","index":0,"type":"function"}]\n\n`,
    ]);
  });

  it('should handle mixed text content followed by streaming tool calls (DeepSeek style)', async () => {
    // This test simulates the stream pattern from DeepSeek models via Qwen API
    // where text content is streamed first, followed by incremental tool call chunks
    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        // Text content chunks with role in first chunk
        controller.enqueue({
          choices: [
            {
              delta: { content: '看来', role: 'assistant' },
              finish_reason: null,
              index: 0,
            },
          ],
          id: 'chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075',
          model: 'deepseek-v3',
          object: 'chat.completion.chunk',
          created: 1767574524,
        });
        controller.enqueue({
          choices: [
            {
              delta: { content: '我的' },
              finish_reason: null,
              index: 0,
            },
          ],
          id: 'chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075',
          model: 'deepseek-v3',
          object: 'chat.completion.chunk',
          created: 1767574524,
        });
        controller.enqueue({
          choices: [
            {
              delta: { content: '函数调用格式有误。' },
              finish_reason: null,
              index: 0,
            },
          ],
          id: 'chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075',
          model: 'deepseek-v3',
          object: 'chat.completion.chunk',
          created: 1767574524,
        });

        // First tool call chunk with id, name, and partial arguments
        controller.enqueue({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: 'call_ff00c42325d74b979990cb',
                    type: 'function',
                    function: {
                      name: 'modelscope-time____get_current_time____mcp',
                      arguments: '{"',
                    },
                    index: 0,
                  },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          id: 'chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075',
          model: 'deepseek-v3',
          object: 'chat.completion.chunk',
          created: 1767574524,
        });

        // Subsequent tool call chunk with only incremental arguments (no id)
        controller.enqueue({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    type: 'function',
                    function: {
                      arguments: 'timezone":"America/New_York"}',
                    },
                    index: 0,
                  },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          id: 'chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075',
          model: 'deepseek-v3',
          object: 'chat.completion.chunk',
          created: 1767574524,
        });

        controller.close();
      },
    });

    const onTextMock = vi.fn();
    const onToolCallMock = vi.fn();

    const protocolStream = QwenAIStream(mockOpenAIStream, {
      callbacks: {
        onText: onTextMock,
        onToolsCalling: onToolCallMock,
      },
    });

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    // Verify complete chunks array
    expect(chunks).toEqual([
      'id: chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075\n',
      'event: text\n',
      'data: "看来"\n\n',
      'id: chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075\n',
      'event: text\n',
      'data: "我的"\n\n',
      'id: chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075\n',
      'event: text\n',
      'data: "函数调用格式有误。"\n\n',
      'id: chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075\n',
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"{\\"","name":"modelscope-time____get_current_time____mcp"},"id":"call_ff00c42325d74b979990cb","index":0,"type":"function"}]\n\n',
      'id: chatcmpl-4f901cb2-91bc-9763-a2c8-3ed58e9f4075\n',
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"timezone\\":\\"America/New_York\\"}","name":null},"id":"call_ff00c42325d74b979990cb","index":0,"type":"function"}]\n\n',
    ]);
  });
});

// Test case for parallel tool calls bug
// This test reproduces the issue where Qwen model returns 3 parallel tool calls
// for querying time in Beijing, Shanghai, and Nanjing simultaneously.
// The bug causes arguments from different tool calls to be incorrectly merged.
describe('parallel tool calls streaming bug', () => {
  it('should handle 3 parallel tool calls with incremental arguments (Qwen qwen3-max behavior)', async () => {
    // This test simulates the exact stream pattern from the bug report:
    // User asks: "查一下北京、上海、南京的时间，同时调用3次mcp"
    // Model returns 3 parallel tool calls with index 0, 1, 2
    // Subsequent chunks contain arguments without id field, only index
    const streamId = 'chatcmpl-23f324a2-059f-9ab4-b7b3-f47bcba5ebf7';

    // Define all chunks as an array for clarity and maintainability
    const chunks = [
      // Chunk 0: First tool call starts (index=0)
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_c7d8b4984a4d4f54a4956bca',
                  type: 'function',
                  function: { name: 'time____get_time____mcp', arguments: '' },
                  index: 0,
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      // Chunk 1: First tool call continues with empty arguments
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  id: 'call_c7d8b4984a4d4f54a4956bca',
                  type: 'function',
                  function: { arguments: '' },
                  index: 0,
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      // Chunk 2: First tool call arguments part 1 (北京)
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { type: 'function', function: { arguments: '{"location": "北京' }, index: 0 },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      // Chunk 3: First tool call arguments part 2
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ type: 'function', function: { arguments: '"}' }, index: 0 }] },
            finish_reason: null,
          },
        ],
      },
      // Chunk 4: Empty arguments for first tool call
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ type: 'function', function: { arguments: '' }, index: 0 }] },
            finish_reason: null,
          },
        ],
      },
      // Chunk 5: Second tool call starts (index=1) - 上海
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  id: 'call_f564785a14534d9a8c5ee641',
                  type: 'function',
                  function: { name: 'time____get_time____mcp', arguments: '' },
                  index: 1,
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      // Chunk 6: Second tool call arguments (上海)
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { type: 'function', function: { arguments: '{"location": "上海' }, index: 1 },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      // Chunk 7: Second tool call arguments part 2
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ type: 'function', function: { arguments: '"}' }, index: 1 }] },
            finish_reason: null,
          },
        ],
      },
      // Chunk 8: Third tool call starts (index=2) - 南京
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  id: 'call_19693813aebd434aab821f06',
                  type: 'function',
                  function: { name: 'time____get_time____mcp', arguments: '{"location": "' },
                  index: 2,
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      // Chunk 9: Third tool call arguments (南京)
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ type: 'function', function: { arguments: '南京"' }, index: 2 }],
            },
            finish_reason: null,
          },
        ],
      },
      // Chunk 10: Third tool call arguments final
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ type: 'function', function: { arguments: '}' }, index: 2 }] },
            finish_reason: null,
          },
        ],
      },
      // Chunk 11: Finish
      {
        id: streamId,
        object: 'chat.completion.chunk',
        created: 1768906556,
        model: 'qwen3-max',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      },
    ];

    const mockOpenAIStream = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });

    let aggregatedToolCalls: any[] = [];

    const protocolStream = QwenAIStream(mockOpenAIStream, {
      callbacks: {
        onToolsCalling: ({ toolsCalling }) => {
          aggregatedToolCalls = toolsCalling;
        },
      },
    });

    const decoder = new TextDecoder();
    const outputChunks: string[] = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      outputChunks.push(decoder.decode(chunk, { stream: true }));
    }

    // Verify streaming chunks output format (SSE protocol)
    // Each tool call chunk should have correct id based on its index
    expect(outputChunks).toEqual([
      // Chunk 0: First tool call starts (index=0)
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"","name":"time____get_time____mcp"},"id":"call_c7d8b4984a4d4f54a4956bca","index":0,"type":"function"}]\n\n',
      // Chunk 1: First tool call continues
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"","name":null},"id":"call_c7d8b4984a4d4f54a4956bca","index":0,"type":"function"}]\n\n',
      // Chunk 2: First tool call arguments part 1
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"{\\"location\\": \\"北京","name":null},"id":"call_c7d8b4984a4d4f54a4956bca","index":0,"type":"function"}]\n\n',
      // Chunk 3: First tool call arguments part 2
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"\\"}","name":null},"id":"call_c7d8b4984a4d4f54a4956bca","index":0,"type":"function"}]\n\n',
      // Chunk 4: Empty arguments
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"","name":null},"id":"call_c7d8b4984a4d4f54a4956bca","index":0,"type":"function"}]\n\n',
      // Chunk 5: Second tool call starts (index=1) - should have its own id
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"","name":"time____get_time____mcp"},"id":"call_f564785a14534d9a8c5ee641","index":1,"type":"function"}]\n\n',
      // Chunk 6: Second tool call arguments - should use index=1's stored id
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"{\\"location\\": \\"上海","name":null},"id":"call_f564785a14534d9a8c5ee641","index":1,"type":"function"}]\n\n',
      // Chunk 7: Second tool call arguments part 2
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"\\"}","name":null},"id":"call_f564785a14534d9a8c5ee641","index":1,"type":"function"}]\n\n',
      // Chunk 8: Third tool call starts (index=2)
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"{\\"location\\": \\"","name":"time____get_time____mcp"},"id":"call_19693813aebd434aab821f06","index":2,"type":"function"}]\n\n',
      // Chunk 9: Third tool call arguments - should use index=2's stored id
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"南京\\"","name":null},"id":"call_19693813aebd434aab821f06","index":2,"type":"function"}]\n\n',
      // Chunk 10: Third tool call arguments final
      `id: ${streamId}\n`,
      'event: tool_calls\n',
      'data: [{"function":{"arguments":"}","name":null},"id":"call_19693813aebd434aab821f06","index":2,"type":"function"}]\n\n',
      // Chunk 11: Finish
      `id: ${streamId}\n`,
      'event: stop\n',
      'data: "tool_calls"\n\n',
    ]);

    // Verify aggregated tool calls have correct arguments (not merged incorrectly)
    expect(aggregatedToolCalls).toHaveLength(3);
    expect(aggregatedToolCalls[0]).toMatchObject({
      id: 'call_c7d8b4984a4d4f54a4956bca',
      function: { name: 'time____get_time____mcp', arguments: '{"location": "北京"}' },
    });
    expect(aggregatedToolCalls[1]).toMatchObject({
      id: 'call_f564785a14534d9a8c5ee641',
      function: { name: 'time____get_time____mcp', arguments: '{"location": "上海"}' },
    });
    expect(aggregatedToolCalls[2]).toMatchObject({
      id: 'call_19693813aebd434aab821f06',
      function: { name: 'time____get_time____mcp', arguments: '{"location": "南京"}' },
    });
  });
});

describe('transformQwenStream', () => {
  it('should handle usage chunk', () => {
    const mockChunk: OpenAI.ChatCompletionChunk = {
      choices: [],
      id: 'usage-test-id',
      model: 'qwen-test-model',
      object: 'chat.completion.chunk',
      created: Date.now(),
      usage: {
        completion_tokens: 50,
        prompt_tokens: 100,
        total_tokens: 150,
        completion_tokens_details: {}, // Ensure these exist even if empty
        prompt_tokens_details: {}, // Ensure these exist even if empty
      },
    };

    const streamContext: StreamContext = { id: '' };

    const result = transformQwenStream(mockChunk, streamContext);

    expect(result).toEqual({
      id: 'usage-test-id',
      type: 'usage',
      data: {
        inputTextTokens: 100,
        outputTextTokens: 50,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      },
    });

    // Verify streamContext is updated
    expect(streamContext.usage).toEqual({
      inputTextTokens: 100,
      outputTextTokens: 50,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
    });
  });

  it('should handle usage chunk without streamContext', () => {
    const mockChunk: OpenAI.ChatCompletionChunk = {
      choices: [],
      id: 'usage-test-id-no-ctx',
      model: 'qwen-test-model',
      object: 'chat.completion.chunk',
      created: Date.now(),
      usage: {
        completion_tokens: 55,
        prompt_tokens: 105,
        total_tokens: 160,
      },
    };

    const result = transformQwenStream(mockChunk); // No streamContext passed

    expect(result).toEqual({
      id: 'usage-test-id-no-ctx',
      type: 'usage',
      data: {
        inputTextTokens: 105,
        outputTextTokens: 55,
        totalInputTokens: 105,
        totalOutputTokens: 55,
        totalTokens: 160,
      },
    });
  });
});
