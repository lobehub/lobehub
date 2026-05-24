import type { ChatResponse } from 'ollama/browser';
import { describe, expect, it, vi } from 'vitest';

import * as uuidModule from '../../utils/uuid';
import { OllamaStream } from './ollama';

describe('OllamaStream', () => {
  describe('should transform Ollama stream to protocol stream', () => {
    describe('reasoning', () => {
      it('reasoning with thinking tag', async () => {
        vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('2');

        const messages = [
          '<think>',
          '这是一个思考过程',
          '，需要仔细分析问题。',
          '</think>',
          '根据分析，我的答案是：',
          '这是最终答案。',
        ];

        const mockOllamaStream = new ReadableStream<ChatResponse>({
          start(controller) {
            messages.forEach((content) => {
              controller.enqueue({ message: { content }, done: false } as ChatResponse);
            });
            controller.enqueue({ message: { content: '' }, done: true } as ChatResponse);
            controller.close();
          },
        });

        const protocolStream = OllamaStream(mockOllamaStream);

        const decoder = new TextDecoder();
        const chunks: string[] = [];

        for await (const chunk of protocolStream) {
          chunks.push(decoder.decode(chunk, { stream: true }));
        }

        expect(chunks).toEqual(
          [
            'id: chat_2',
            'event: reasoning',
            `data: ""\n`,
            'id: chat_2',
            'event: reasoning',
            `data: "这是一个思考过程"\n`,
            'id: chat_2',
            'event: reasoning',
            `data: "，需要仔细分析问题。"\n`,
            'id: chat_2',
            'event: text',
            `data: ""\n`,
            'id: chat_2',
            'event: text',
            `data: "根据分析，我的答案是："\n`,
            'id: chat_2',
            'event: text',
            `data: "这是最终答案。"\n`,
            'id: chat_2',
            'event: stop',
            `data: "finished"\n`,
          ].map((line) => `${line}\n`),
        );
      });

      it('thinking field', async () => {
        vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

        const mockOllamaStream = new ReadableStream<ChatResponse>({
          start(controller) {
            controller.enqueue({ message: { thinking: 'Hello' }, done: false } as ChatResponse);
            controller.enqueue({ message: { thinking: ' world!' }, done: false } as ChatResponse);
            controller.enqueue({ message: { thinking: '' }, done: true } as ChatResponse);

            controller.close();
          },
        });

        const onStartMock = vi.fn();
        const onTextMock = vi.fn();
        const onCompletionMock = vi.fn();

        const protocolStream = OllamaStream(mockOllamaStream, {
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
          'event: reasoning\n',
          `data: "Hello"\n\n`,
          'id: chat_1\n',
          'event: reasoning\n',
          `data: " world!"\n\n`,
          'id: chat_1\n',
          'event: stop\n',
          `data: "finished"\n\n`,
        ]);
      });
    });

    it('text', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({ message: { content: 'Hello' }, done: false } as ChatResponse);
          controller.enqueue({ message: { content: ' world!' }, done: false } as ChatResponse);
          controller.enqueue({ message: { content: '' }, done: true } as ChatResponse);

          controller.close();
        },
      });

      const onStartMock = vi.fn();
      const onTextMock = vi.fn();
      const onCompletionMock = vi.fn();

      const protocolStream = OllamaStream(mockOllamaStream, {
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

    it('tools use', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('abcd1234');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({
            model: 'qwen2.5',
            created_at: new Date('2024-12-01T03:34:55.166692Z'),
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  function: {
                    name: 'realtime-weather____fetchCurrentWeather',
                    arguments: { city: '杭州' },
                  },
                },
              ],
            },
            done: false,
          } as unknown as ChatResponse);
          controller.enqueue({
            model: 'qwen2.5',
            created_at: '2024-12-01T03:34:55.2133Z',
            message: { role: 'assistant', content: '' },
            done_reason: 'stop',
            done: true,
            total_duration: 1122415333,
            load_duration: 26178333,
            prompt_eval_count: 221,
            prompt_eval_duration: 507000000,
            eval_count: 26,
            eval_duration: 583000000,
          } as unknown as ChatResponse);

          controller.close();
        },
      });
      const onStartMock = vi.fn();
      const onTextMock = vi.fn();
      const onToolCall = vi.fn();
      const onCompletionMock = vi.fn();

      const protocolStream = OllamaStream(mockOllamaStream, {
        onStart: onStartMock,
        onText: onTextMock,
        onCompletion: onCompletionMock,
        onToolsCalling: onToolCall,
      });

      const decoder = new TextDecoder();
      const chunks: string[] = [];

      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"city\\":\\"杭州\\"}","name":"realtime-weather____fetchCurrentWeather"},"id":"realtime-weather____fetchCurrentWeather_0_abcd1234","index":0,"type":"function"}]\n`,
          'id: chat_1',
          'event: stop',
          `data: "finished"\n`,
        ].map((i) => `${i}\n`),
      );

      expect(onTextMock).toHaveBeenCalledTimes(0);
      expect(onStartMock).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onCompletionMock).toHaveBeenCalledTimes(1);
    });

    it('tools use with a done', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('abcd1234');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({
            model: 'qwen2.5',
            created_at: new Date('2024-12-01T03:34:55.166692Z'),
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  function: {
                    name: 'realtime-weather____fetchCurrentWeather',
                    arguments: { city: '杭州' },
                  },
                },
              ],
            },
            done_reason: 'stop',
            done: true,
            total_duration: 1122415333,
            load_duration: 26178333,
            prompt_eval_count: 221,
            prompt_eval_duration: 507000000,
            eval_count: 26,
            eval_duration: 583000000,
          } as unknown as ChatResponse);

          controller.close();
        },
      });
      const onStartMock = vi.fn();
      const onTextMock = vi.fn();
      const onToolCall = vi.fn();
      const onCompletionMock = vi.fn();

      const protocolStream = OllamaStream(mockOllamaStream, {
        onStart: onStartMock,
        onText: onTextMock,
        onCompletion: onCompletionMock,
        onToolsCalling: onToolCall,
      });

      const decoder = new TextDecoder();
      const chunks: string[] = [];

      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"city\\":\\"杭州\\"}","name":"realtime-weather____fetchCurrentWeather"},"id":"realtime-weather____fetchCurrentWeather_0_abcd1234","index":0,"type":"function"}]\n`,
        ].map((i) => `${i}\n`),
      );

      expect(onTextMock).toHaveBeenCalledTimes(0);
      expect(onStartMock).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onCompletionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('textual tool call recovery', () => {
    it('should recover tool_call from XML text in content', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('tcid1');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({
            message: {
              content:
                '<tool_call>\n<invoke name="terminal">\n<parameter name="command">ls -la</parameter>\n</invoke>\n</tool_call>',
            },
            done: false,
          } as unknown as ChatResponse);
          controller.enqueue({ message: { content: '' }, done: true } as unknown as ChatResponse);
          controller.close();
        },
      });

      const onToolCall = vi.fn();
      const onTextMock = vi.fn();

      const protocolStream = OllamaStream(mockOllamaStream, {
        onText: onTextMock,
        onToolsCalling: onToolCall,
      });

      const decoder = new TextDecoder();
      const chunks: string[] = [];

      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"command\\":\\"ls -la\\"}","name":"terminal"},"id":"terminal_0_tcid1","index":0,"type":"function"}]\n`,
          'id: chat_1',
          'event: stop',
          `data: "finished"\n`,
        ].map((i) => `${i}\n`),
      );

      expect(onTextMock).toHaveBeenCalledTimes(0);
      expect(onToolCall).toHaveBeenCalledTimes(1);
    });

    it('should recover namespaced minimax:tool_call from XML text', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('tcid2');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({
            message: {
              content:
                '<minimax:tool_call>\n<invoke name="execute_code">\n<parameter name="language">python</parameter>\n<parameter name="code">print(42)</parameter>\n</invoke>\n</minimax:tool_call>',
            },
            done: false,
          } as ChatResponse);
          controller.enqueue({ message: { content: '' }, done: true } as ChatResponse);
          controller.close();
        },
      });

      const protocolStream = OllamaStream(mockOllamaStream);

      const decoder = new TextDecoder();
      const chunks: string[] = [];

      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"language\\":\\"python\\",\\"code\\":\\"print(42)\\"}","name":"execute_code"},"id":"execute_code_0_tcid2","index":0,"type":"function"}]\n`,
          'id: chat_1',
          'event: stop',
          `data: "finished"\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should recover textual tool call with preceding text', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('tcid3');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({
            message: { content: 'Let me check that file for you.\n\n', done: false },
          } as unknown as ChatResponse);
          controller.enqueue({
            message: {
              content:
                '<tool_call>\n<invoke name="read_file">\n<parameter name="path">/etc/config.json</parameter>\n</invoke>\n</tool_call>',
            },
            done: false,
          } as unknown as ChatResponse);
          controller.enqueue({ message: { content: '' }, done: true } as unknown as ChatResponse);
          controller.close();
        },
      });

      const onTextMock = vi.fn();
      const onToolCall = vi.fn();

      const protocolStream = OllamaStream(mockOllamaStream, {
        onText: onTextMock,
        onToolsCalling: onToolCall,
      });

      const decoder = new TextDecoder();
      const chunks: string[] = [];

      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: text',
          `data: "Let me check that file for you.\\n\\n"\n`,
          'id: chat_1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"path\\":\\"/etc/config.json\\"}","name":"read_file"},"id":"read_file_0_tcid3","index":0,"type":"function"}]\n`,
          'id: chat_1',
          'event: stop',
          `data: "finished"\n`,
        ].map((i) => `${i}\n`),
      );

      expect(onTextMock).toHaveBeenCalledTimes(1);
      expect(onTextMock).toHaveBeenNthCalledWith(1, 'Let me check that file for you.\n\n');
      expect(onToolCall).toHaveBeenCalledTimes(1);
    });

    it('should handle fragmented tool call XML across multiple chunks', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('tcid4');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({
            message: { content: 'I will run that.\n\n<tool_call>\n<invoke name="', done: false },
          } as unknown as ChatResponse);
          controller.enqueue({
            message: { content: 'bash">\n<parameter name="command">echo hello</parameter>\n', done: false },
          } as unknown as ChatResponse);
          controller.enqueue({
            message: { content: '</invoke>\n</tool_call>', done: false },
          } as unknown as ChatResponse);
          controller.enqueue({ message: { content: '' }, done: true } as unknown as ChatResponse);
          controller.close();
        },
      });

      const protocolStream = OllamaStream(mockOllamaStream);

      const decoder = new TextDecoder();
      const chunks: string[] = [];

      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: text',
          `data: "I will run that.\\n\\n"\n`,
          'id: chat_1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"command\\":\\"echo hello\\"}","name":"bash"},"id":"bash_0_tcid4","index":0,"type":"function"}]\n`,
          'id: chat_1',
          'event: stop',
          `data: "finished"\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should recover standalone <invoke> blocks without <tool_call> wrapper', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1').mockReturnValueOnce('tcid5');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({
            message: {
              content:
                '<invoke name="search">\n<parameter name="query">latest news</parameter>\n</invoke>',
            },
            done: false,
          } as unknown as ChatResponse);
          controller.enqueue({ message: { content: '' }, done: true } as unknown as ChatResponse);
          controller.close();
        },
      });

      const protocolStream = OllamaStream(mockOllamaStream);

      const decoder = new TextDecoder();
      const chunks: string[] = [];

      for await (const chunk of protocolStream) {
        chunks.push(decoder.decode(chunk, { stream: true }));
      }

      expect(chunks).toEqual(
        [
          'id: chat_1',
          'event: tool_calls',
          `data: [{"function":{"arguments":"{\\"query\\":\\"latest news\\"}","name":"search"},"id":"search_0_tcid5","index":0,"type":"function"}]\n`,
          'id: chat_1',
          'event: stop',
          `data: "finished"\n`,
        ].map((i) => `${i}\n`),
      );
    });

    it('should not affect normal text content', async () => {
      vi.spyOn(uuidModule, 'nanoid').mockReturnValueOnce('1');

      const mockOllamaStream = new ReadableStream<ChatResponse>({
        start(controller) {
          controller.enqueue({ message: { content: 'Hello' }, done: false } as ChatResponse);
          controller.enqueue({ message: { content: ' world!' }, done: false } as ChatResponse);
          controller.enqueue({ message: { content: '' }, done: true } as ChatResponse);
          controller.close();
        },
      });

      const protocolStream = OllamaStream(mockOllamaStream);

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
    });
  });

  it('should handle empty stream', async () => {
    const mockOllamaStream = new ReadableStream<ChatResponse>({
      start(controller) {
        controller.close();
      },
    });

    const protocolStream = OllamaStream(mockOllamaStream);

    const decoder = new TextDecoder();
    const chunks: string[] = [];

    for await (const chunk of protocolStream) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([]);
  });
});
