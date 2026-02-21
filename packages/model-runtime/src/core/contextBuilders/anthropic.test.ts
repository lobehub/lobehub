import { imageUrlToBase64 } from '@lobechat/utils';
import type { OpenAI } from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenAIChatMessage, UserMessageContentPart } from '../../types/chat';
import { parseDataUri } from '../../utils/uriParser';
import {
  buildAnthropicBlock,
  buildAnthropicMessage,
  buildAnthropicMessages,
  buildAnthropicTools,
} from './anthropic';

// Mock the parseDataUri function since it's an implementation detail
vi.mock('../../utils/uriParser');
vi.mock('@lobechat/utils', () => ({
  imageUrlToBase64: vi.fn(),
}));

describe('anthropicHelpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Set default mock implementation for parseDataUri
    vi.mocked(parseDataUri).mockReturnValue({
      mimeType: 'image/jpeg',
      base64: 'base64EncodedString',
      type: 'base64',
    });
  });

  describe('buildAnthropicBlock', () => {
    it('should return the content as is for text type', async () => {
      const content: UserMessageContentPart = { type: 'text', text: 'Hello!' };
      const result = await buildAnthropicBlock(content);
      expect(result).toEqual(content);
    });

    it('should transform an image URL into an Anthropic.ImageBlockParam', async () => {
      const content: UserMessageContentPart = {
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,base64EncodedString' },
      };
      const result = await buildAnthropicBlock(content);
      expect(parseDataUri).toHaveBeenCalledWith(content.image_url.url);
      expect(result).toEqual({
        source: {
          data: 'base64EncodedString',
          media_type: 'image/jpeg',
          type: 'base64',
        },
        type: 'image',
      });
    });

    it('should transform a regular image URL into an Anthropic.ImageBlockParam', async () => {
      vi.mocked(parseDataUri).mockReturnValueOnce({
        mimeType: 'image/png',
        base64: null,
        type: 'url',
      });
      vi.mocked(imageUrlToBase64).mockResolvedValueOnce({
        base64: 'convertedBase64String',
        mimeType: 'image/jpg',
      });

      const content = {
        type: 'image_url',
        image_url: { url: 'https://example.com/image.png' },
      } as const;

      const result = await buildAnthropicBlock(content);

      expect(parseDataUri).toHaveBeenCalledWith(content.image_url.url);
      expect(imageUrlToBase64).toHaveBeenCalledWith(content.image_url.url);
      expect(result).toEqual({
        source: {
          data: 'convertedBase64String',
          media_type: 'image/jpg',
          type: 'base64',
        },
        type: 'image',
      });
    });

    it('should use default media_type for URL images when mimeType is not provided', async () => {
      vi.mocked(parseDataUri).mockReturnValueOnce({
        mimeType: null,
        base64: null,
        type: 'url',
      });
      vi.mocked(imageUrlToBase64).mockResolvedValueOnce({
        base64: 'convertedBase64String',
        mimeType: 'image/png',
      });

      const content = {
        type: 'image_url',
        image_url: { url: 'https://example.com/image' },
      } as const;

      const result = await buildAnthropicBlock(content);

      expect(result).toEqual({
        source: {
          data: 'convertedBase64String',
          media_type: 'image/png',
          type: 'base64',
        },
        type: 'image',
      });
    });

    it('should throw an error for invalid image URLs', async () => {
      vi.mocked(parseDataUri).mockReturnValueOnce({
        mimeType: null,
        base64: null,
        // @ts-ignore
        type: 'invalid',
      });

      const content = {
        type: 'image_url',
        image_url: { url: 'invalid-url' },
      } as const;

      await expect(buildAnthropicBlock(content)).rejects.toThrow('Invalid image URL: invalid-url');
    });

    it('should return undefined for unsupported SVG image (base64)', async () => {
      vi.mocked(parseDataUri).mockReturnValueOnce({
        mimeType: 'image/svg+xml',
        base64: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==',
        type: 'base64',
      });

      const content = {
        type: 'image_url',
        image_url: {
          url: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==',
        },
      } as const;

      const result = await buildAnthropicBlock(content);
      expect(result).toBeUndefined();
    });

    it('should return undefined for unsupported SVG image (URL)', async () => {
      vi.mocked(parseDataUri).mockReturnValueOnce({
        mimeType: null,
        base64: null,
        type: 'url',
      });
      vi.mocked(imageUrlToBase64).mockResolvedValueOnce({
        base64: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==',
        mimeType: 'image/svg+xml',
      });

      const content = {
        type: 'image_url',
        image_url: { url: 'https://example.com/image.svg' },
      } as const;

      const result = await buildAnthropicBlock(content);
      expect(result).toBeUndefined();
    });
  });

  describe('buildAnthropicMessage', () => {
    it('should correctly convert system message to assistant message', async () => {
      const message: OpenAIChatMessage = {
        content: [{ type: 'text', text: 'Hello!' }],
        role: 'system',
      };
      const result = await buildAnthropicMessage(message);
      expect(result).toEqual({ content: [{ type: 'text', text: 'Hello!' }], role: 'user' });
    });

    it('should correctly convert user message with string content', async () => {
      const message: OpenAIChatMessage = {
        content: 'Hello!',
        role: 'user',
      };
      const result = await buildAnthropicMessage(message);
      expect(result).toEqual({ content: 'Hello!', role: 'user' });
    });

    it('should correctly convert user message with content parts', async () => {
      const message: OpenAIChatMessage = {
        content: [
          { type: 'text', text: 'Check out this image:' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
        ],
        role: 'user',
      };
      const result = await buildAnthropicMessage(message);
      expect(result!.role).toBe('user');
      expect(result!.content).toHaveLength(2);
      expect((result!.content[1] as any).type).toBe('image');
    });

    it('should correctly convert tool message', async () => {
      const message: OpenAIChatMessage = {
        content: 'Tool result content',
        role: 'tool',
        tool_call_id: 'tool123',
      };
      const result = await buildAnthropicMessage(message);
      expect(result!.role).toBe('user');
      expect(result!.content).toEqual([
        {
          content: 'Tool result content',
          tool_use_id: 'tool123',
          type: 'tool_result',
        },
      ]);
    });

    it('should correctly convert assistant message with tool calls', async () => {
      const message: OpenAIChatMessage = {
        content: 'Here is the result:',
        role: 'assistant',
        tool_calls: [
          {
            id: 'call1',
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"query":"anthropic"}',
            },
          },
        ],
      };
      const result = await buildAnthropicMessage(message);
      expect(result!.role).toBe('assistant');
      expect(result!.content).toEqual([
        { text: 'Here is the result:', type: 'text' },
        {
          id: 'call1',
          input: { query: 'anthropic' },
          name: 'search',
          type: 'tool_use',
        },
      ]);
    });

    it('should correctly convert function message', async () => {
      const message: OpenAIChatMessage = {
        content: 'def hello(name):\n  return f"Hello {name}"',
        role: 'function',
      };
      const result = await buildAnthropicMessage(message);
      expect(result).toEqual({
        content: 'def hello(name):\n  return f"Hello {name}"',
        role: 'assistant',
      });
    });

    it('should correctly convert assistant message with array content but no tool_calls', async () => {
      const message: OpenAIChatMessage = {
        content: [
          { thinking: 'Let me think about this...', type: 'thinking', signature: 'sig123' },
          { type: 'text', text: 'Here is my response.' },
        ],
        role: 'assistant',
      };
      const result = await buildAnthropicMessage(message);
      expect(result).toEqual({
        content: [
          { thinking: 'Let me think about this...', type: 'thinking', signature: 'sig123' },
          { type: 'text', text: 'Here is my response.' },
        ],
        role: 'assistant',
      });
    });

    it('should return undefined for assistant message with empty array content', async () => {
      const message: OpenAIChatMessage = {
        content: [],
        role: 'assistant',
      };
      const result = await buildAnthropicMessage(message);
      expect(result).toBeUndefined();
    });

    it('should handle assistant message with tool_calls but null content', async () => {
      const message: OpenAIChatMessage = {
        content: null as any,
        role: 'assistant',
        tool_calls: [
          {
            id: 'call1',
            type: 'function',
            function: {
              name: 'search_people',
              arguments: '{"location":"Singapore"}',
            },
          },
        ],
      };
      const result = await buildAnthropicMessage(message);
      expect(result!.role).toBe('assistant');
      // null content should be filtered out, only tool_use remains
      expect(result!.content).toEqual([
        {
          id: 'call1',
          input: { location: 'Singapore' },
          name: 'search_people',
          type: 'tool_use',
        },
      ]);
    });

    it('should handle assistant message with tool_calls but empty string content', async () => {
      const message: OpenAIChatMessage = {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            id: 'call1',
            type: 'function',
            function: {
              name: 'search_people',
              arguments: '{"location":"Singapore"}',
            },
          },
        ],
      };
      const result = await buildAnthropicMessage(message);
      expect(result!.role).toBe('assistant');
      // empty string content should be filtered out, only tool_use remains
      expect(result!.content).toEqual([
        {
          id: 'call1',
          input: { location: 'Singapore' },
          name: 'search_people',
          type: 'tool_use',
        },
      ]);
    });
  });

  describe('buildAnthropicMessages', () => {
    it('should correctly convert OpenAI Messages to Anthropic Messages', async () => {
      const messages: OpenAIChatMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
      ];

      const result = await buildAnthropicMessages(messages);
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
      ]);
    });

    it('messages should dont need end with user', async () => {
      const messages: OpenAIChatMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
      ];

      const contents = await buildAnthropicMessages(messages);

      expect(contents).toHaveLength(3);
      expect(contents).toEqual([
        { content: 'Hello', role: 'user' },
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
      ]);
    });

    describe('Tool messages', () => {
      it('should handle empty tools', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: '## Tools\n\nYou can use these tools',
            role: 'user',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [],
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        // Empty assistant messages should be filtered out
        expect(contents).toEqual([
          {
            content: '## Tools\n\nYou can use these tools',
            role: 'user',
          },
        ]);
      });

      it('should filter out assistant message with whitespace-only content', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: 'Hello',
            role: 'user',
          },
          {
            content: '   \n\t  ',
            role: 'assistant',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        // Whitespace-only assistant messages should be filtered out
        expect(contents).toEqual([
          {
            content: 'Hello',
            role: 'user',
          },
        ]);
      });
      it('should correctly convert OpenAI tool message to Anthropic format', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: '告诉我杭州和北京的天气，先回答我好的',
            role: 'user',
          },
          {
            content:
              '好的,我会为您查询杭州和北京的天气信息。我现在就开始查询这两个城市的当前天气情况。',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"city": "\\u676d\\u5dde"}',
                  name: 'realtime-weather____fetchCurrentWeather',
                },
                id: 'toolu_018PNQkH8ChbjoJz4QBiFVod',
                type: 'function',
              },
              {
                function: {
                  arguments: '{"city": "\\u5317\\u4eac"}',
                  name: 'realtime-weather____fetchCurrentWeather',
                },
                id: 'toolu_018VQTQ6fwAEC3eppuEfMxPp',
                type: 'function',
              },
            ],
          },
          {
            content:
              '[{"city":"杭州市","adcode":"330100","province":"浙江","reporttime":"2024-06-24 17:02:14","casts":[{"date":"2024-06-24","week":"1","dayweather":"小雨","nightweather":"中雨","daytemp":"26","nighttemp":"20","daywind":"西","nightwind":"西","daypower":"1-3","nightpower":"1-3","daytemp_float":"26.0","nighttemp_float":"20.0"},{"date":"2024-06-25","week":"2","dayweather":"大雨","nightweather":"中雨","daytemp":"23","nighttemp":"19","daywind":"东","nightwind":"东","daypower":"1-3","nightpower":"1-3","daytemp_float":"23.0","nighttemp_float":"19.0"},{"date":"2024-06-26","week":"3","dayweather":"中雨","nightweather":"中雨","daytemp":"24","nighttemp":"21","daywind":"东南","nightwind":"东南","daypower":"1-3","nightpower":"1-3","daytemp_float":"24.0","nighttemp_float":"21.0"},{"date":"2024-06-27","week":"4","dayweather":"中雨-大雨","nightweather":"中雨","daytemp":"24","nighttemp":"22","daywind":"南","nightwind":"南","daypower":"1-3","nightpower":"1-3","daytemp_float":"24.0","nighttemp_float":"22.0"}]}]',
            name: 'realtime-weather____fetchCurrentWeather',
            role: 'tool',
            tool_call_id: 'toolu_018PNQkH8ChbjoJz4QBiFVod',
          },
          {
            content:
              '[{"city":"北京市","adcode":"110000","province":"北京","reporttime":"2024-06-24 17:03:11","casts":[{"date":"2024-06-24","week":"1","dayweather":"晴","nightweather":"晴","daytemp":"33","nighttemp":"20","daywind":"北","nightwind":"北","daypower":"1-3","nightpower":"1-3","daytemp_float":"33.0","nighttemp_float":"20.0"},{"date":"2024-06-25","week":"2","dayweather":"晴","nightweather":"晴","daytemp":"35","nighttemp":"21","daywind":"东南","nightwind":"东南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"21.0"},{"date":"2024-06-26","week":"3","dayweather":"晴","nightweather":"晴","daytemp":"35","nighttemp":"23","daywind":"西南","nightwind":"西南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"23.0"},{"date":"2024-06-27","week":"4","dayweather":"多云","nightweather":"多云","daytemp":"35","nighttemp":"23","daywind":"西南","nightwind":"西南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"23.0"}]}]',
            name: 'realtime-weather____fetchCurrentWeather',
            role: 'tool',
            tool_call_id: 'toolu_018VQTQ6fwAEC3eppuEfMxPp',
          },
          {
            content: '继续',
            role: 'user',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          { content: '告诉我杭州和北京的天气，先回答我好的', role: 'user' },
          {
            content: [
              {
                text: '好的,我会为您查询杭州和北京的天气信息。我现在就开始查询这两个城市的当前天气情况。',
                type: 'text',
              },
              {
                id: 'toolu_018PNQkH8ChbjoJz4QBiFVod',
                input: { city: '杭州' },
                name: 'realtime-weather____fetchCurrentWeather',
                type: 'tool_use',
              },
              {
                id: 'toolu_018VQTQ6fwAEC3eppuEfMxPp',
                input: { city: '北京' },
                name: 'realtime-weather____fetchCurrentWeather',
                type: 'tool_use',
              },
            ],
            role: 'assistant',
          },
          {
            content: [
              {
                content: [
                  {
                    text: '[{"city":"杭州市","adcode":"330100","province":"浙江","reporttime":"2024-06-24 17:02:14","casts":[{"date":"2024-06-24","week":"1","dayweather":"小雨","nightweather":"中雨","daytemp":"26","nighttemp":"20","daywind":"西","nightwind":"西","daypower":"1-3","nightpower":"1-3","daytemp_float":"26.0","nighttemp_float":"20.0"},{"date":"2024-06-25","week":"2","dayweather":"大雨","nightweather":"中雨","daytemp":"23","nighttemp":"19","daywind":"东","nightwind":"东","daypower":"1-3","nightpower":"1-3","daytemp_float":"23.0","nighttemp_float":"19.0"},{"date":"2024-06-26","week":"3","dayweather":"中雨","nightweather":"中雨","daytemp":"24","nighttemp":"21","daywind":"东南","nightwind":"东南","daypower":"1-3","nightpower":"1-3","daytemp_float":"24.0","nighttemp_float":"21.0"},{"date":"2024-06-27","week":"4","dayweather":"中雨-大雨","nightweather":"中雨","daytemp":"24","nighttemp":"22","daywind":"南","nightwind":"南","daypower":"1-3","nightpower":"1-3","daytemp_float":"24.0","nighttemp_float":"22.0"}]}]',
                    type: 'text',
                  },
                ],
                tool_use_id: 'toolu_018PNQkH8ChbjoJz4QBiFVod',
                type: 'tool_result',
              },
              {
                content: [
                  {
                    text: '[{"city":"北京市","adcode":"110000","province":"北京","reporttime":"2024-06-24 17:03:11","casts":[{"date":"2024-06-24","week":"1","dayweather":"晴","nightweather":"晴","daytemp":"33","nighttemp":"20","daywind":"北","nightwind":"北","daypower":"1-3","nightpower":"1-3","daytemp_float":"33.0","nighttemp_float":"20.0"},{"date":"2024-06-25","week":"2","dayweather":"晴","nightweather":"晴","daytemp":"35","nighttemp":"21","daywind":"东南","nightwind":"东南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"21.0"},{"date":"2024-06-26","week":"3","dayweather":"晴","nightweather":"晴","daytemp":"35","nighttemp":"23","daywind":"西南","nightwind":"西南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"23.0"},{"date":"2024-06-27","week":"4","dayweather":"多云","nightweather":"多云","daytemp":"35","nighttemp":"23","daywind":"西南","nightwind":"西南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"23.0"}]}]',
                    type: 'text',
                  },
                ],
                tool_use_id: 'toolu_018VQTQ6fwAEC3eppuEfMxPp',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
          { content: '继续', role: 'user' },
        ]);
      });
      it('should handle user messages with tool correctly', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: '搜索下 482的所有质因数？\n\n',
            role: 'user',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"query": "482的质因数分解"}',
                  name: 'searchWithSearXNG',
                },
                id: 'toolu_01AgNoyb9FKuY8TGePPjEfrE',
                type: 'function',
              },
            ],
          },
          {
            content:
              '[{"content":"因式分解, 2 * 241 ; 因数, 1, 2, 241, 482 ; 因数个数, 4 ; 因数和, 726 ; 前一个整数, 481.","title":"该数性质482","url":"https://zh.numberempire.com/482"}]',
            name: 'searchWithSearXNG',
            role: 'tool',
            tool_call_id: 'toolu_01AgNoyb9FKuY8TGePPjEfrE',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          { content: '搜索下 482的所有质因数？\n\n', role: 'user' },
          {
            content: [
              {
                id: 'toolu_01AgNoyb9FKuY8TGePPjEfrE',
                input: { query: '482的质因数分解' },
                name: 'searchWithSearXNG',
                type: 'tool_use',
              },
            ],
            role: 'assistant',
          },
          {
            content: [
              {
                content: [
                  {
                    text: '[{"content":"因式分解, 2 * 241 ; 因数, 1, 2, 241, 482 ; 因数个数, 4 ; 因数和, 726 ; 前一个整数, 481.","title":"该数性质482","url":"https://zh.numberempire.com/482"}]',
                    type: 'text',
                  },
                ],
                tool_use_id: 'toolu_01AgNoyb9FKuY8TGePPjEfrE',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should handle tool message with null content', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: '搜索人员',
            role: 'user',
          },
          {
            content: '正在搜索...',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"location": "Singapore"}',
                  name: 'search_people',
                },
                id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                type: 'function',
              },
            ],
          },
          {
            content: null as any,
            name: 'search_people',
            role: 'tool',
            tool_call_id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          { content: '搜索人员', role: 'user' },
          {
            content: [
              { text: '正在搜索...', type: 'text' },
              {
                id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                input: { location: 'Singapore' },
                name: 'search_people',
                type: 'tool_use',
              },
            ],
            role: 'assistant',
          },
          {
            content: [
              {
                content: [{ text: '<empty_content>', type: 'text' }],
                tool_use_id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should handle tool message with empty string content', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: '搜索人员',
            role: 'user',
          },
          {
            content: '正在搜索...',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"location": "Singapore"}',
                  name: 'search_people',
                },
                id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                type: 'function',
              },
            ],
          },
          {
            content: '',
            name: 'search_people',
            role: 'tool',
            tool_call_id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          { content: '搜索人员', role: 'user' },
          {
            content: [
              { text: '正在搜索...', type: 'text' },
              {
                id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                input: { location: 'Singapore' },
                name: 'search_people',
                type: 'tool_use',
              },
            ],
            role: 'assistant',
          },
          {
            content: [
              {
                content: [{ text: '<empty_content>', type: 'text' }],
                tool_use_id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should handle tool message with array content', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: '搜索人员',
            role: 'user',
          },
          {
            content: '正在搜索...',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"location": "Singapore"}',
                  name: 'search_people',
                },
                id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                type: 'function',
              },
            ],
          },
          {
            content: [
              { type: 'text', text: 'Found 5 candidates' },
              { type: 'text', text: 'Result details here' },
            ] as any,
            name: 'search_people',
            role: 'tool',
            tool_call_id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          { content: '搜索人员', role: 'user' },
          {
            content: [
              { text: '正在搜索...', type: 'text' },
              {
                id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                input: { location: 'Singapore' },
                name: 'search_people',
                type: 'tool_use',
              },
            ],
            role: 'assistant',
          },
          {
            content: [
              {
                content: [
                  { type: 'text', text: 'Found 5 candidates' },
                  { type: 'text', text: 'Result details here' },
                ],
                tool_use_id: 'toolu_01CnXPcBEqsGGbvRriem3Rth',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should handle tool message with array content containing image', async () => {
        vi.mocked(parseDataUri).mockReturnValueOnce({
          mimeType: 'image/png',
          base64: 'screenshotBase64Data',
          type: 'base64',
        });

        const messages: OpenAIChatMessage[] = [
          {
            content: '截图分析',
            role: 'user',
          },
          {
            content: '正在截图...',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"url": "https://example.com"}',
                  name: 'screenshot',
                },
                id: 'toolu_screenshot_123',
                type: 'function',
              },
            ],
          },
          {
            content: [
              { type: 'text', text: 'Screenshot captured' },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,screenshotBase64Data' },
              },
            ] as any,
            name: 'screenshot',
            role: 'tool',
            tool_call_id: 'toolu_screenshot_123',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          { content: '截图分析', role: 'user' },
          {
            content: [
              { text: '正在截图...', type: 'text' },
              {
                id: 'toolu_screenshot_123',
                input: { url: 'https://example.com' },
                name: 'screenshot',
                type: 'tool_use',
              },
            ],
            role: 'assistant',
          },
          {
            content: [
              {
                content: [
                  { type: 'text', text: 'Screenshot captured' },
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: 'screenshotBase64Data',
                    },
                  },
                ],
                tool_use_id: 'toolu_screenshot_123',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should handle orphan tool message with null content', async () => {
        // Tool message without corresponding assistant tool_call
        const messages: OpenAIChatMessage[] = [
          {
            content: null as any,
            name: 'some_tool',
            role: 'tool',
            tool_call_id: 'orphan_tool_call_id',
          },
          {
            content: 'Continue',
            role: 'user',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          {
            content: '<empty_content>',
            role: 'user',
          },
          {
            content: 'Continue',
            role: 'user',
          },
        ]);
      });

      it('should handle orphan tool message with empty string content', async () => {
        // Tool message without corresponding assistant tool_call
        const messages: OpenAIChatMessage[] = [
          {
            content: '',
            name: 'some_tool',
            role: 'tool',
            tool_call_id: 'orphan_tool_call_id',
          },
          {
            content: 'Continue',
            role: 'user',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          {
            content: '<empty_content>',
            role: 'user',
          },
          {
            content: 'Continue',
            role: 'user',
          },
        ]);
      });

      it('should work well starting with tool message', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content:
              '[{"content":"因式分解, 2 * 241 ; 因数, 1, 2, 241, 482 ; 因数个数, 4 ; 因数和, 726 ; 前一个整数, 481.","title":"该数性质482","url":"https://zh.numberempire.com/482"}]',
            name: 'searchWithSearXNG',
            role: 'tool',
            tool_call_id: 'toolu_01AgNoyb9FKuY8TGePPjEfrE',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"query": "杭州有啥好吃的"}',
                  name: 'searchWithSearXNG',
                },
                id: 'toolu_02AgNoyb9FKuY8TGePPjEfrE',
                type: 'function',
              },
            ],
          },
          {
            content: '[{"content":"没啥好吃的","title":"该数性质482","url":"e.com/482"}]',
            name: 'searchWithSearXNG',
            role: 'tool',
            tool_call_id: 'toolu_02AgNoyb9FKuY8TGePPjEfrE',
          },
        ];

        const contents = await buildAnthropicMessages(messages);

        expect(contents).toEqual([
          {
            content:
              '[{"content":"因式分解, 2 * 241 ; 因数, 1, 2, 241, 482 ; 因数个数, 4 ; 因数和, 726 ; 前一个整数, 481.","title":"该数性质482","url":"https://zh.numberempire.com/482"}]',
            role: 'user',
          },
          {
            content: [
              {
                id: 'toolu_02AgNoyb9FKuY8TGePPjEfrE',
                input: {
                  query: '杭州有啥好吃的',
                },
                name: 'searchWithSearXNG',
                type: 'tool_use',
              },
            ],
            role: 'assistant',
          },
          {
            content: [
              {
                content: [
                  {
                    text: '[{"content":"没啥好吃的","title":"该数性质482","url":"e.com/482"}]',
                    type: 'text',
                  },
                ],
                tool_use_id: 'toolu_02AgNoyb9FKuY8TGePPjEfrE',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
        ]);
      });
    });

    it('should correctly handle thinking content part', async () => {
      const messages: OpenAIChatMessage[] = [
        {
          content: '告诉我杭州和北京的天气，先回答我好的',
          role: 'user',
        },
        {
          content: [
            { thinking: '经过一番思考', type: 'thinking', signature: '123' },
            {
              type: 'text',
              text: '好的,我会为您查询杭州和北京的天气信息。我现在就开始查询这两个城市的当前天气情况。',
            },
          ],
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: '{"city": "\\u676d\\u5dde"}',
                name: 'realtime-weather____fetchCurrentWeather',
              },
              id: 'toolu_018PNQkH8ChbjoJz4QBiFVod',
              type: 'function',
            },
            {
              function: {
                arguments: '{"city": "\\u5317\\u4eac"}',
                name: 'realtime-weather____fetchCurrentWeather',
              },
              id: 'toolu_018VQTQ6fwAEC3eppuEfMxPp',
              type: 'function',
            },
          ],
        },
        {
          content:
            '[{"city":"杭州市","adcode":"330100","province":"浙江","reporttime":"2024-06-24 17:02:14","casts":[{"date":"2024-06-24","week":"1","dayweather":"小雨","nightweather":"中雨","daytemp":"26","nighttemp":"20","daywind":"西","nightwind":"西","daypower":"1-3","nightpower":"1-3","daytemp_float":"26.0","nighttemp_float":"20.0"},{"date":"2024-06-25","week":"2","dayweather":"大雨","nightweather":"中雨","daytemp":"23","nighttemp":"19","daywind":"东","nightwind":"东","daypower":"1-3","nightpower":"1-3","daytemp_float":"23.0","nighttemp_float":"19.0"},{"date":"2024-06-26","week":"3","dayweather":"中雨","nightweather":"中雨","daytemp":"24","nighttemp":"21","daywind":"东南","nightwind":"东南","daypower":"1-3","nightpower":"1-3","daytemp_float":"24.0","nighttemp_float":"21.0"},{"date":"2024-06-27","week":"4","dayweather":"中雨-大雨","nightweather":"中雨","daytemp":"24","nighttemp":"22","daywind":"南","nightwind":"南","daypower":"1-3","nightpower":"1-3","daytemp_float":"24.0","nighttemp_float":"22.0"}]}]',
          name: 'realtime-weather____fetchCurrentWeather',
          role: 'tool',
          tool_call_id: 'toolu_018PNQkH8ChbjoJz4QBiFVod',
        },
        {
          content:
            '[{"city":"北京市","adcode":"110000","province":"北京","reporttime":"2024-06-24 17:03:11","casts":[{"date":"2024-06-24","week":"1","dayweather":"晴","nightweather":"晴","daytemp":"33","nighttemp":"20","daywind":"北","nightwind":"北","daypower":"1-3","nightpower":"1-3","daytemp_float":"33.0","nighttemp_float":"20.0"},{"date":"2024-06-25","week":"2","dayweather":"晴","nightweather":"晴","daytemp":"35","nighttemp":"21","daywind":"东南","nightwind":"东南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"21.0"},{"date":"2024-06-26","week":"3","dayweather":"晴","nightweather":"晴","daytemp":"35","nighttemp":"23","daywind":"西南","nightwind":"西南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"23.0"},{"date":"2024-06-27","week":"4","dayweather":"多云","nightweather":"多云","daytemp":"35","nighttemp":"23","daywind":"西南","nightwind":"西南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"23.0"}]}]',
          name: 'realtime-weather____fetchCurrentWeather',
          role: 'tool',
          tool_call_id: 'toolu_018VQTQ6fwAEC3eppuEfMxPp',
        },
        {
          content: '继续',
          role: 'user',
        },
      ];

      const contents = await buildAnthropicMessages(messages);

      expect(contents).toEqual([
        { content: '告诉我杭州和北京的天气，先回答我好的', role: 'user' },
        {
          content: [
            {
              signature: '123',
              thinking: '经过一番思考',
              type: 'thinking',
            },
            {
              text: '好的,我会为您查询杭州和北京的天气信息。我现在就开始查询这两个城市的当前天气情况。',
              type: 'text',
            },
            {
              id: 'toolu_018PNQkH8ChbjoJz4QBiFVod',
              input: { city: '杭州' },
              name: 'realtime-weather____fetchCurrentWeather',
              type: 'tool_use',
            },
            {
              id: 'toolu_018VQTQ6fwAEC3eppuEfMxPp',
              input: { city: '北京' },
              name: 'realtime-weather____fetchCurrentWeather',
              type: 'tool_use',
            },
          ],
          role: 'assistant',
        },
        {
          content: [
            {
              content: [
                {
                  text: '[{"city":"杭州市","adcode":"330100","province":"浙江","reporttime":"2024-06-24 17:02:14","casts":[{"date":"2024-06-24","week":"1","dayweather":"小雨","nightweather":"中雨","daytemp":"26","nighttemp":"20","daywind":"西","nightwind":"西","daypower":"1-3","nightpower":"1-3","daytemp_float":"26.0","nighttemp_float":"20.0"},{"date":"2024-06-25","week":"2","dayweather":"大雨","nightweather":"中雨","daytemp":"23","nighttemp":"19","daywind":"东","nightwind":"东","daypower":"1-3","nightpower":"1-3","daytemp_float":"23.0","nighttemp_float":"19.0"},{"date":"2024-06-26","week":"3","dayweather":"中雨","nightweather":"中雨","daytemp":"24","nighttemp":"21","daywind":"东南","nightwind":"东南","daypower":"1-3","nightpower":"1-3","daytemp_float":"24.0","nighttemp_float":"21.0"},{"date":"2024-06-27","week":"4","dayweather":"中雨-大雨","nightweather":"中雨","daytemp":"24","nighttemp":"22","daywind":"南","nightwind":"南","daypower":"1-3","nightpower":"1-3","daytemp_float":"24.0","nighttemp_float":"22.0"}]}]',
                  type: 'text',
                },
              ],
              tool_use_id: 'toolu_018PNQkH8ChbjoJz4QBiFVod',
              type: 'tool_result',
            },
            {
              content: [
                {
                  text: '[{"city":"北京市","adcode":"110000","province":"北京","reporttime":"2024-06-24 17:03:11","casts":[{"date":"2024-06-24","week":"1","dayweather":"晴","nightweather":"晴","daytemp":"33","nighttemp":"20","daywind":"北","nightwind":"北","daypower":"1-3","nightpower":"1-3","daytemp_float":"33.0","nighttemp_float":"20.0"},{"date":"2024-06-25","week":"2","dayweather":"晴","nightweather":"晴","daytemp":"35","nighttemp":"21","daywind":"东南","nightwind":"东南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"21.0"},{"date":"2024-06-26","week":"3","dayweather":"晴","nightweather":"晴","daytemp":"35","nighttemp":"23","daywind":"西南","nightwind":"西南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"23.0"},{"date":"2024-06-27","week":"4","dayweather":"多云","nightweather":"多云","daytemp":"35","nighttemp":"23","daywind":"西南","nightwind":"西南","daypower":"1-3","nightpower":"1-3","daytemp_float":"35.0","nighttemp_float":"23.0"}]}]',
                  type: 'text',
                },
              ],
              tool_use_id: 'toolu_018VQTQ6fwAEC3eppuEfMxPp',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        { content: '继续', role: 'user' },
      ]);
    });

    it('should enable cache control', async () => {
      const messages: OpenAIChatMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
      ];

      const contents = await buildAnthropicMessages(messages, { enabledContextCaching: true });

      expect(contents).toHaveLength(3);
      expect(contents).toEqual([
        { content: 'Hello', role: 'user' },
        { content: 'Hello', role: 'user' },
        {
          content: [{ cache_control: { type: 'ephemeral' }, text: 'Hi', type: 'text' }],
          role: 'assistant',
        },
      ]);
    });
  });

  describe('buildAnthropicTools', () => {
    it('should correctly convert OpenAI tools to Anthropic format', () => {
      const tools: OpenAI.ChatCompletionTool[] = [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Searches the web',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        },
      ];

      const result = buildAnthropicTools(tools);

      expect(result).toEqual([
        {
          name: 'search',
          description: 'Searches the web',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      ]);
    });
    it('should enable cache control', () => {
      const tools: OpenAI.ChatCompletionTool[] = [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Searches the web',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        },
      ];

      const result = buildAnthropicTools(tools, { enabledContextCaching: true });

      expect(result).toEqual([
        {
          name: 'search',
          description: 'Searches the web',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
          cache_control: { type: 'ephemeral' },
        },
      ]);
    });
  });
});
