import type { Stream } from '@anthropic-ai/sdk/streaming';
import { describe, expect, it, vi } from 'vitest';

import { AnthropicStream } from './anthropic';

describe('AnthropicStream', () => {
  it('should transform Anthropic stream to protocol stream', async () => {
    // @ts-ignore
    const mockAnthropicStream: Stream = {
      [Symbol.asyncIterator]() {
        let count = 0;
        return {
          next: async () => {
            switch (count) {
              case 0: {
                count++;
                return {
                  done: false,
                  value: {
                    type: 'message_start',
                    message: { id: 'message_1', metadata: {} },
                  },
                };
              }
              case 1: {
                count++;
                return {
                  done: false,
                  value: {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: 'Hello' },
                  },
                };
              }
              case 2: {
                count++;
                return {
                  done: false,
                  value: {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: ' world!' },
                  },
                };
              }
              case 3: {
                count++;
                return {
                  done: false,
                  value: {
                    type: 'message_delta',
                    delta: { stop_reason: 'stop' },
                  },
                };
              }
              default: {
                return { done: true, value: undefined };
              }
            }
          },
        };
      },
    };

    const onStartMock = vi.fn();
    const onTextMock = vi.fn();
    const onCompletionMock = vi.fn();

    const protocolStream = AnthropicStream(mockAnthropicStream, {
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
      'id: message_1\n',
      'event: data\n',
      `data: {"id":"message_1","metadata":{}}\n\n`,
      'id: message_1\n',
      'event: text\n',
      `data: "Hello"\n\n`,
      'id: message_1\n',
      'event: text\n',
      `data: " world!"\n\n`,
      'id: message_1\n',
      'event: stop\n',
      `data: "stop"\n\n`,
    ]);

    expect(onStartMock).toHaveBeenCalledTimes(1);
    expect(onTextMock).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onTextMock).toHaveBeenNthCalledWith(2, ' world!');
    expect(onCompletionMock).toHaveBeenCalledTimes(1);
  });

  it('should handle tool use event and ReadableStream input', async () => {
    const streams = [
      {
        type: 'message_start',
        message: {
          id: 'msg_017aTuY86wNxth5TE544yqJq',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-sonnet-20240229',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 457, output_tokens: 1 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '的:' } },

      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'toolu_01WdYWxYFQ8iu5iZq1Dy9Saf',
          name: 'realtime-weather____fetchCurrentWeather',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"city": "' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '杭' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '州"}' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 83 },
      },
    ];

    const mockReadableStream = new ReadableStream({
      start(controller) {
        streams.forEach((chunk) => {
          controller.enqueue(chunk);
        });
        controller.close();
      },
    });

    const onToolCallMock = vi.fn();

    const protocolStream = AnthropicStream(mockReadableStream, {
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
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: data',
        'data: {"id":"msg_017aTuY86wNxth5TE544yqJq","type":"message","role":"assistant","model":"claude-3-sonnet-20240229","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":457,"output_tokens":1}}\n',
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: data',
        'data: ""\n',
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: text',
        'data: "好"\n',
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: text',
        'data: "的:"\n',
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: data',
        'data: {"type":"content_block_stop","index":0}\n',
        // Tool calls
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: tool_calls',
        `data: [{"function":{"arguments":"","name":"realtime-weather____fetchCurrentWeather"},"id":"toolu_01WdYWxYFQ8iu5iZq1Dy9Saf","index":0,"type":"function"}]\n`,
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: tool_calls',
        `data: [{"function":{"arguments":""},"index":0,"type":"function"}]\n`,
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: tool_calls',
        `data: [{"function":{"arguments":"{\\"city\\": \\""},"index":0,"type":"function"}]\n`,
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: tool_calls',

        `data: [{"function":{"arguments":"杭"},"index":0,"type":"function"}]\n`,
        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: tool_calls',

        `data: [{"function":{"arguments":"州\\"}"},"index":0,"type":"function"}]\n`,

        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: data',
        'data: {"type":"content_block_stop","index":1}\n',

        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: stop',
        'data: "tool_use"\n',

        'id: msg_017aTuY86wNxth5TE544yqJq',
        'event: usage',
        'data: {"inputCacheMissTokens":457,"totalInputTokens":457,"totalOutputTokens":84,"totalTokens":541}\n',
      ].map((item) => `${item}\n`),
    );

    expect(onToolCallMock).toHaveBeenCalledTimes(5);
  });
  it('should handle parallel tools use event and ReadableStream input', async () => {
    const streams = [
      {
        type: 'message_start',
        message: {
          id: 'msg_0175ryA67RbGrnRrGBXFQEYK',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-sonnet-20240620',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 485, output_tokens: 4 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '好的,我会为您查询杭州和北京的天气情况。' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '请稍等,我现在开始获取这两个城市的天气信息。' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'toolu_011NuszmBcxskstLWe4z4z5B',
          name: 'realtime-weather____fetchCurrentWeather',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"city": "杭州"}' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'tool_use',
          id: 'toolu_01HojNiibMiKnYFvLrJyfX3B',
          name: 'realtime-weather____fetchCurrentWeather',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"city": "北京"}' },
      },
      { type: 'content_block_stop', index: 2 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 150 },
      },
      { type: 'message_stop' },
    ];

    const mockReadableStream = new ReadableStream({
      start(controller) {
        streams.forEach((chunk) => {
          controller.enqueue(chunk);
        });
        controller.close();
      },
    });

    const onToolCallMock = vi.fn();

    const protocolStream = AnthropicStream(mockReadableStream, {
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
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: data',
        'data: {"id":"msg_0175ryA67RbGrnRrGBXFQEYK","type":"message","role":"assistant","model":"claude-3-5-sonnet-20240620","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":485,"output_tokens":4}}\n',
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: data',
        'data: ""\n',
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: text',
        'data: "好的,我会为您查询杭州和北京的天气情况。"\n',
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: text',
        'data: "请稍等,我现在开始获取这两个城市的天气信息。"\n',
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: data',
        'data: {"type":"content_block_stop","index":0}\n',
        // Tool calls
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: tool_calls',
        `data: [{"function":{"arguments":"","name":"realtime-weather____fetchCurrentWeather"},"id":"toolu_011NuszmBcxskstLWe4z4z5B","index":0,"type":"function"}]\n`,
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: tool_calls',
        `data: [{"function":{"arguments":""},"index":0,"type":"function"}]\n`,
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: tool_calls',
        `data: [{"function":{"arguments":"{\\"city\\": \\"杭州\\"}"},"index":0,"type":"function"}]\n`,
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: data',
        `data: {"type":"content_block_stop","index":1}\n`,
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: tool_calls',
        `data: [{"function":{"arguments":"","name":"realtime-weather____fetchCurrentWeather"},"id":"toolu_01HojNiibMiKnYFvLrJyfX3B","index":1,"type":"function"}]\n`,
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: tool_calls',
        `data: [{"function":{"arguments":""},"index":1,"type":"function"}]\n`,
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: tool_calls',
        `data: [{"function":{"arguments":"{\\"city\\": \\"北京\\"}"},"index":1,"type":"function"}]\n`,

        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: data',
        'data: {"type":"content_block_stop","index":2}\n',

        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: stop',
        'data: "tool_use"\n',

        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: usage',
        'data: {"inputCacheMissTokens":485,"totalInputTokens":485,"totalOutputTokens":154,"totalTokens":639}\n',
        'id: msg_0175ryA67RbGrnRrGBXFQEYK',
        'event: stop',
        'data: "message_stop"\n',
      ].map((item) => `${item}\n`),
    );

    expect(onToolCallMock).toHaveBeenCalledTimes(6);
  });

  it('should handle prompts context caching', async () => {
    const streams = [
      {
        type: 'message_start',
        message: {
          id: 'msg_01Vxc4yQTEjkDSba3N3BMbH8',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-7-sonnet-20250219',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 6,
            cache_creation_input_tokens: 457,
            cache_read_input_tokens: 17918,
            output_tokens: 2,
          },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '\n\n根' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '/\n[^20]: https://s' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 3222 },
      },
      { type: 'message_stop' },
    ];

    const mockReadableStream = new ReadableStream({
      start(controller) {
        streams.forEach((chunk) => {
          controller.enqueue(chunk);
        });
        controller.close();
      },
    });

    const protocolStream = AnthropicStream(mockReadableStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: msg_01Vxc4yQTEjkDSba3N3BMbH8',
        'event: data',
        'data: {"id":"msg_01Vxc4yQTEjkDSba3N3BMbH8","type":"message","role":"assistant","model":"claude-3-7-sonnet-20250219","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":6,"cache_creation_input_tokens":457,"cache_read_input_tokens":17918,"output_tokens":2}}\n',
        'id: msg_01Vxc4yQTEjkDSba3N3BMbH8',
        'event: data',
        'data: ""\n',
        'id: msg_01Vxc4yQTEjkDSba3N3BMbH8',
        'event: text',
        'data: "\\n\\n根"\n',
        'id: msg_01Vxc4yQTEjkDSba3N3BMbH8',
        'event: text',
        'data: "/\\n[^20]: https://s"\n',
        'id: msg_01Vxc4yQTEjkDSba3N3BMbH8',
        'event: data',
        'data: {"type":"content_block_stop","index":0}\n',
        'id: msg_01Vxc4yQTEjkDSba3N3BMbH8',
        'event: stop',
        'data: "end_turn"\n',
        'id: msg_01Vxc4yQTEjkDSba3N3BMbH8',
        'event: usage',
        'data: {"inputCacheMissTokens":6,"inputCachedTokens":17918,"inputWriteCacheTokens":457,"totalInputTokens":18381,"totalOutputTokens":3224,"totalTokens":21605}\n',

        'id: msg_01Vxc4yQTEjkDSba3N3BMbH8',
        'event: stop',
        'data: "message_stop"\n',
      ].map((item) => `${item}\n`),
    );
  });
  describe('thinking', () => {
    it('should handle normal thinking ', async () => {
      const streams = [
        {
          type: 'message_start',
          message: {
            id: 'msg_01MNsLe7n1uVLtu6W8rCFujD',
            type: 'message',
            role: 'assistant',
            model: 'claude-3-7-sonnet-20250219',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 46,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 11,
            },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '我需要比较两个数字的' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '大小：9.8和9' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '11\n\n所以9.8比9.11大。' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'signature_delta',
            signature:
              'EuYBCkQYAiJAHnHRJG4nPBrdTlo6CmXoyE8WYoQeoPiLnXaeuaM8ExdiIEkVvxK1DYXOz5sCubs2s/G1NsST8A003Zb8XmuhYBIMwDGMZSZ3+gxOEBpVGgzdpOlDNBTxke31SngiMKUk6WcSiA11OSVBuInNukoAhnRd5jPAEg7e5mIoz/qJwnQHV8I+heKUreP77eJdFipQaM3FHn+avEHuLa/Z/fu0O9BftDi+caB1UWDwJakNeWX1yYTvK+N1v4gRpKbj4AhctfYHMjq8qX9XTnXme5AGzCYC6HgYw2/RfalWzwNxI6k=',
          },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: '9.8比9.11大。' },
        },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 354 },
        },
        { type: 'message_stop' },
      ];

      const mockReadableStream = new ReadableStream({
        start(controller) {
          streams.forEach((chunk) => {
            controller.enqueue(chunk);
          });
          controller.close();
        },
      });

      const protocolStream = AnthropicStream(mockReadableStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: data',
          'data: {"id":"msg_01MNsLe7n1uVLtu6W8rCFujD","type":"message","role":"assistant","model":"claude-3-7-sonnet-20250219","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":46,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":11}}\n',
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: reasoning',
          'data: ""\n',
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: reasoning',
          'data: "我需要比较两个数字的"\n',
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: reasoning',
          'data: "大小：9.8和9"\n',
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: reasoning',
          'data: "11\\n\\n所以9.8比9.11大。"\n',
          // Tool calls
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: reasoning_signature',
          `data: "EuYBCkQYAiJAHnHRJG4nPBrdTlo6CmXoyE8WYoQeoPiLnXaeuaM8ExdiIEkVvxK1DYXOz5sCubs2s/G1NsST8A003Zb8XmuhYBIMwDGMZSZ3+gxOEBpVGgzdpOlDNBTxke31SngiMKUk6WcSiA11OSVBuInNukoAhnRd5jPAEg7e5mIoz/qJwnQHV8I+heKUreP77eJdFipQaM3FHn+avEHuLa/Z/fu0O9BftDi+caB1UWDwJakNeWX1yYTvK+N1v4gRpKbj4AhctfYHMjq8qX9XTnXme5AGzCYC6HgYw2/RfalWzwNxI6k="\n`,
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: data',
          `data: {"type":"content_block_stop","index":0}\n`,
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: data',
          `data: ""\n`,
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: text',
          `data: "9.8比9.11大。"\n`,
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: data',
          `data: {"type":"content_block_stop","index":1}\n`,
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: stop',
          'data: "end_turn"\n',
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: usage',
          'data: {"inputCacheMissTokens":46,"totalInputTokens":46,"totalOutputTokens":365,"totalTokens":411}\n',
          'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
          'event: stop',
          'data: "message_stop"\n',
        ].map((item) => `${item}\n`),
      );
    });

    it('should handle flagged thinking ', async () => {
      const streams = [
        {
          type: 'message_start',
          message: {
            id: 'msg_019q32esPvu3TftzZnL6JPys',
            type: 'message',
            role: 'assistant',
            model: 'claude-3-7-sonnet-20250219',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 92,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 4,
            },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'redacted_thinking',
            data: 'EvYBCoYBGAIiQNzXoJZW+Ocan2YajVtfm4HE2B3NJdxl05x4M+qDZ2XDAv8uysmma7oaIwNsO/gaZDcaYphIPVvSR0da9BiU4fkqQOseUkmKX3f2PDTFQsTVPGJQdiAoojyYWydq912tQiaWOAnV8pEpsw5qzAhjTg7a/VhucOXRjSO6PrBGUJs4IGgSDEOrVeGKw+XJKwI32RoMXxGUrsCpnzifc238IjCiip27oNxaDKqsGVsa3l8CxznwldGK5o7NKoAWxBr6EjmUyWBfHSjCBSG58dLhH6AqHTHs1h7CpyC9q2PiGFKyI6Qpyq27LMf/IJrL4JzY',
          },
        },
        { type: 'ping' },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'redacted_thinking',
            data: 'EqsCCoYBGAIiQFOzsK5wAM+th5SAo3iYCtupF+/ToOYMoKuQowEkQdMYSr+uTiZGV17Ezt1YopNShapyJHraaanqud0SpjNWb1EqQAIs1xKVmShDP/KzTnkeGj3sB1w9fjEcB8I4Q1oYXmAOvEeBRp+/0eszpC5KM4vfBXockGREIX3b9t0aVkKV5LQSDMMox34k4/t6jt5lwBoM8BCR+z8yvwr8RmRAIjCuZUKwzt5cpTSSKsMRF5w/NkH0KeVbDPkHJAHoyKbVThaz2tNP4DGn9Hje/eOhm14qUjEqjkE7ZBa4oXfutU09Ekn6S+Cn5SsYrFLeg+o4/8ewb8YHuspvYbMMN4IwbkqQp19hi2z6QxUWWbLrpMe40Fi2PNKct/dmGmw/SF692L/tyOU=',
          },
        },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'content_block_start',
          index: 2,
          content_block: {
            type: 'redacted_thinking',
            data: 'EowCCoYBGAIiQK1Px08f5EwkoGrjGov2SWq2eHJVrkwBhL9atUCuZegNB+yK0F2ENixvwLlFjZOeSDhfVZ3von76crqoGaEUOUgqQGnTe9FWXAOXYnreuT4sCpUCVSq6pyewyyYCJkAVHTc8YCgPQsGagW9qNmUJDNdCoFyMEtFzqRuHZk3nc/9KjJgSDK4yegsNIw6czWXdCxoMzzrg26MN6RjFUrRqIjAjjEWG7mPPMolxAVvscgcaETILV4WtO4xOXDxK0L2NLSb+GlR7LQraWOATBMBc0lAqM43SvsI2xLX6GvdtNIr98tAKXpadetuHoDta+uqVn9dRfJG6Nno0e1cdx9VzgrOM2I0l6w==',
          },
        },
        { type: 'content_block_stop', index: 2 },
        {
          type: 'content_block_start',
          index: 3,
          content_block: {
            type: 'redacted_thinking',
            data: 'EvMGCoYBGAIiQKkoAFWygajHbTRK/q0hrakXULQBWfg0/EAiNRami4uuzOwDVEPBDu74aP47MMQG0zhLspVkvGpOlfNLkkeROYEqQHO9MLpvtKDkob22tAH2ctP7CxIhI+SRZ0flou71sDdaVtcsel2dIas8+soULHfW68glHJ1ormzeUKv9YHtvVxMSDIC31I3S0nvTPOB/GxoMos7jtbwUPmYvx4viIjD01EiiuBny4srom6xEm/c9VCJQaRKuglEehQ3BRxn2Qs28eGNs7EV63kF5DHV7QTIqmQUaw3A/XKIK+2dhPMzE9/n7VSeWvPl7lFLgTCZBW+q49KoLNuIw5tGMR2nXxTrykvQt9zhNDb9TYAsu8nubMASJt9hWwwMpXAPJhUOP5IL+/p6YDuN9Y5TbDkCiR+3Dgs4xh6VeBhD0cusWdC2LefHT92i1dz2mCFhTtPG8nr/jChOGv/KPPO24sJcSMUYu1T07ohiDCe6vjEckBP2aaSH46rcGEydFBaufPKGD2LsiQfrFDRx639AFlwdeSz30cRrjYCiXBu3l/it0LYt8m5Ixsn41P0xFiPDfecZAkGymvrV8JrS0uPnRbpF9n4CNj1YanoplbVgA9yegj962PnRBHwIoT/UMTLnBgxNE1J9LM6JuMbDQRXpYpZ7OaB9FXwxCKjcWgSiGmiPjdWwan8z7cILDes3Kz9sBaqF4s6uj9eJ31fFL9dHKS0jciCrOPMfKUOQSP/HRuAUsyeyUROquh4MIfXLUUPrFCXyyy42wBvrTXkdWOGZF/wMw6YQGC3iNbgldO4K6OBc8+6+AhRsZR51EuBp1iMl5na6KspyVJnCMx52lUYq3SXNTZkiika/z1jO3C1+cvrzQggo9Yf56bzjKBlVjdjqsIqaNOB8BQqU8EidE668/7cMLF3YJP2YwohEO1C7vOV1vliNkyxdCFz6qB9q8vzZ1hIlFz8LHVxZRmmlMMnAq/Q9nWOXmi/6lIXVRIP+4z6dyIWNINTR/D2ZsMjN34cnDgxgbzGuDoicikliSnJG+RB1smJSAmMrNf+U+JZSW2zpU+7zu1dZm5DMKlef+pmbIJMCxVS7v98vAxt/tO+99HlXwhktL4JuOdC2TcvrDm56e2IeGY0KR5TVA2sfCqxEyb+QAAbwDD7TDwq+r62GVBA==',
          },
        },
        { type: 'content_block_stop', index: 3 },
        { type: 'content_block_start', index: 4, content_block: { type: 'text', text: '' } },
        {
          type: 'content_block_delta',
          index: 4,
          delta: {
            type: 'text_delta',
            text: "I'm not able to respond to special commands or triggers",
          },
        },
        {
          type: 'content_block_delta',
          index: 4,
          delta: {
            type: 'text_delta',
            text: ' with information, answer questions, or assist with many other ways.',
          },
        },
        { type: 'content_block_stop', index: 4 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 259 },
        },
        { type: 'message_stop' },
      ];

      const mockReadableStream = new ReadableStream({
        start(controller) {
          streams.forEach((chunk) => {
            controller.enqueue(chunk);
          });
          controller.close();
        },
      });

      const protocolStream = AnthropicStream(mockReadableStream);

      const decoder = new TextDecoder();
      const chunks = [];

      // @ts-ignore
      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: data',
          'data: {"id":"msg_019q32esPvu3TftzZnL6JPys","type":"message","role":"assistant","model":"claude-3-7-sonnet-20250219","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":92,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":4}}\n',
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: flagged_reasoning_signature',
          'data: "EvYBCoYBGAIiQNzXoJZW+Ocan2YajVtfm4HE2B3NJdxl05x4M+qDZ2XDAv8uysmma7oaIwNsO/gaZDcaYphIPVvSR0da9BiU4fkqQOseUkmKX3f2PDTFQsTVPGJQdiAoojyYWydq912tQiaWOAnV8pEpsw5qzAhjTg7a/VhucOXRjSO6PrBGUJs4IGgSDEOrVeGKw+XJKwI32RoMXxGUrsCpnzifc238IjCiip27oNxaDKqsGVsa3l8CxznwldGK5o7NKoAWxBr6EjmUyWBfHSjCBSG58dLhH6AqHTHs1h7CpyC9q2PiGFKyI6Qpyq27LMf/IJrL4JzY"\n',
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: data',
          'data: {"type":"ping"}\n',
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: data',
          'data: {"type":"content_block_stop","index":0}\n',
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: flagged_reasoning_signature',
          'data: "EqsCCoYBGAIiQFOzsK5wAM+th5SAo3iYCtupF+/ToOYMoKuQowEkQdMYSr+uTiZGV17Ezt1YopNShapyJHraaanqud0SpjNWb1EqQAIs1xKVmShDP/KzTnkeGj3sB1w9fjEcB8I4Q1oYXmAOvEeBRp+/0eszpC5KM4vfBXockGREIX3b9t0aVkKV5LQSDMMox34k4/t6jt5lwBoM8BCR+z8yvwr8RmRAIjCuZUKwzt5cpTSSKsMRF5w/NkH0KeVbDPkHJAHoyKbVThaz2tNP4DGn9Hje/eOhm14qUjEqjkE7ZBa4oXfutU09Ekn6S+Cn5SsYrFLeg+o4/8ewb8YHuspvYbMMN4IwbkqQp19hi2z6QxUWWbLrpMe40Fi2PNKct/dmGmw/SF692L/tyOU="\n',
          // Tool calls
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: data',
          `data: {"type":"content_block_stop","index":1}\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: flagged_reasoning_signature',
          `data: "EowCCoYBGAIiQK1Px08f5EwkoGrjGov2SWq2eHJVrkwBhL9atUCuZegNB+yK0F2ENixvwLlFjZOeSDhfVZ3von76crqoGaEUOUgqQGnTe9FWXAOXYnreuT4sCpUCVSq6pyewyyYCJkAVHTc8YCgPQsGagW9qNmUJDNdCoFyMEtFzqRuHZk3nc/9KjJgSDK4yegsNIw6czWXdCxoMzzrg26MN6RjFUrRqIjAjjEWG7mPPMolxAVvscgcaETILV4WtO4xOXDxK0L2NLSb+GlR7LQraWOATBMBc0lAqM43SvsI2xLX6GvdtNIr98tAKXpadetuHoDta+uqVn9dRfJG6Nno0e1cdx9VzgrOM2I0l6w=="\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: data',
          `data: {"type":"content_block_stop","index":2}\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: flagged_reasoning_signature',
          `data: "EvMGCoYBGAIiQKkoAFWygajHbTRK/q0hrakXULQBWfg0/EAiNRami4uuzOwDVEPBDu74aP47MMQG0zhLspVkvGpOlfNLkkeROYEqQHO9MLpvtKDkob22tAH2ctP7CxIhI+SRZ0flou71sDdaVtcsel2dIas8+soULHfW68glHJ1ormzeUKv9YHtvVxMSDIC31I3S0nvTPOB/GxoMos7jtbwUPmYvx4viIjD01EiiuBny4srom6xEm/c9VCJQaRKuglEehQ3BRxn2Qs28eGNs7EV63kF5DHV7QTIqmQUaw3A/XKIK+2dhPMzE9/n7VSeWvPl7lFLgTCZBW+q49KoLNuIw5tGMR2nXxTrykvQt9zhNDb9TYAsu8nubMASJt9hWwwMpXAPJhUOP5IL+/p6YDuN9Y5TbDkCiR+3Dgs4xh6VeBhD0cusWdC2LefHT92i1dz2mCFhTtPG8nr/jChOGv/KPPO24sJcSMUYu1T07ohiDCe6vjEckBP2aaSH46rcGEydFBaufPKGD2LsiQfrFDRx639AFlwdeSz30cRrjYCiXBu3l/it0LYt8m5Ixsn41P0xFiPDfecZAkGymvrV8JrS0uPnRbpF9n4CNj1YanoplbVgA9yegj962PnRBHwIoT/UMTLnBgxNE1J9LM6JuMbDQRXpYpZ7OaB9FXwxCKjcWgSiGmiPjdWwan8z7cILDes3Kz9sBaqF4s6uj9eJ31fFL9dHKS0jciCrOPMfKUOQSP/HRuAUsyeyUROquh4MIfXLUUPrFCXyyy42wBvrTXkdWOGZF/wMw6YQGC3iNbgldO4K6OBc8+6+AhRsZR51EuBp1iMl5na6KspyVJnCMx52lUYq3SXNTZkiika/z1jO3C1+cvrzQggo9Yf56bzjKBlVjdjqsIqaNOB8BQqU8EidE668/7cMLF3YJP2YwohEO1C7vOV1vliNkyxdCFz6qB9q8vzZ1hIlFz8LHVxZRmmlMMnAq/Q9nWOXmi/6lIXVRIP+4z6dyIWNINTR/D2ZsMjN34cnDgxgbzGuDoicikliSnJG+RB1smJSAmMrNf+U+JZSW2zpU+7zu1dZm5DMKlef+pmbIJMCxVS7v98vAxt/tO+99HlXwhktL4JuOdC2TcvrDm56e2IeGY0KR5TVA2sfCqxEyb+QAAbwDD7TDwq+r62GVBA=="\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: data',
          `data: {"type":"content_block_stop","index":3}\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: data',
          `data: ""\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: text',
          `data: "I'm not able to respond to special commands or triggers"\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: text',
          `data: " with information, answer questions, or assist with many other ways."\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: data',
          `data: {"type":"content_block_stop","index":4}\n`,
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: stop',
          'data: "end_turn"\n',
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: usage',
          'data: {"inputCacheMissTokens":92,"totalInputTokens":92,"totalOutputTokens":263,"totalTokens":355}\n',
          'id: msg_019q32esPvu3TftzZnL6JPys',
          'event: stop',
          'data: "message_stop"\n',
        ].map((item) => `${item}\n`),
      );
    });
  });

  it('should handle ReadableStream input', async () => {
    const mockReadableStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'message_start',
          message: { id: 'message_1', metadata: {} },
        });
        controller.enqueue({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        });
        controller.enqueue({
          type: 'message_stop',
        });
        controller.close();
      },
    });

    const protocolStream = AnthropicStream(mockReadableStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: message_1\n',
      'event: data\n',
      `data: {"id":"message_1","metadata":{}}\n\n`,
      'id: message_1\n',
      'event: text\n',
      `data: "Hello"\n\n`,
      'id: message_1\n',
      'event: stop\n',
      `data: "message_stop"\n\n`,
    ]);
  });

  it('should handle un-normal block type', async () => {
    const streams = [
      {
        type: 'message_start',
        message: {
          id: 'msg_01MNsLe7n1uVLtu6W8rCFujD',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-7-sonnet-20250219',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 46,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 11,
          },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: 'abc', signature: 'dddd' },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: null },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'abc', abc: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'abc', abc: '123' },
      },
    ];

    const mockReadableStream = new ReadableStream({
      start(controller) {
        streams.forEach((chunk) => {
          controller.enqueue(chunk);
        });
        controller.close();
      },
    });

    const protocolStream = AnthropicStream(mockReadableStream);

    const decoder = new TextDecoder();
    const chunks = [];

    // @ts-ignore
    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual(
      [
        'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
        'event: data',
        'data: {"id":"msg_01MNsLe7n1uVLtu6W8rCFujD","type":"message","role":"assistant","model":"claude-3-7-sonnet-20250219","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":46,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":11}}\n',
        'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
        'event: reasoning',
        'data: "abc"\n',
        'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
        'event: reasoning_signature',
        'data: "dddd"\n',
        'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
        'event: data',
        'data: {"type":"thinking","thinking":null}\n',
        'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
        'event: data',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"abc","abc":""}}\n',
        'id: msg_01MNsLe7n1uVLtu6W8rCFujD',
        'event: data',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"abc","abc":"123"}}\n',
      ].map((item) => `${item}\n`),
    );
  });
});
