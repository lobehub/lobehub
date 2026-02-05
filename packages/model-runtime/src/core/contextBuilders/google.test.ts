// @vitest-environment node
import { Type as SchemaType } from '@google/genai';
import * as imageToBase64Module from '@lobechat/utils';
import { describe, expect, it, vi } from 'vitest';

import type { ChatCompletionTool, OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { parseDataUri } from '../../utils/uriParser';
import {
  buildGoogleMessage,
  buildGoogleMessages,
  buildGooglePart,
  buildGoogleTool,
  buildGoogleTools,
  GEMINI_MAGIC_THOUGHT_SIGNATURE,
} from './google';

// Mock the utils
vi.mock('../../utils/uriParser', () => ({
  parseDataUri: vi.fn(),
}));

vi.mock('../../utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));

describe('google contextBuilders', () => {
  describe('buildGooglePart', () => {
    it('should handle text type messages', async () => {
      const content: UserMessageContentPart = {
        text: 'Hello',
        type: 'text',
      };

      const result = await buildGooglePart(content);

      expect(result).toEqual({ text: 'Hello', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE });
    });

    it('should handle thinking type messages', async () => {
      const content: UserMessageContentPart = {
        signature: 'abc',
        thinking: 'Hello',
        type: 'thinking',
      };

      const result = await buildGooglePart(content);

      expect(result).toEqual(undefined);
    });

    it('should handle base64 type images', async () => {
      const base64Image =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
        type: 'base64',
      });

      const content: UserMessageContentPart = {
        image_url: { url: base64Image },
        type: 'image_url',
      };

      const result = await buildGooglePart(content);

      expect(result).toEqual({
        inlineData: {
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==',
          mimeType: 'image/png',
        },
        thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
      });
    });

    it('should handle URL type images', async () => {
      const imageUrl = 'http://example.com/image.png';
      const mockBase64 = 'mockBase64Data';

      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: null,
        mimeType: 'image/png',
        type: 'url',
      });

      vi.spyOn(imageToBase64Module, 'imageUrlToBase64').mockResolvedValueOnce({
        base64: mockBase64,
        mimeType: 'image/png',
      });

      const content: UserMessageContentPart = {
        image_url: { url: imageUrl },
        type: 'image_url',
      };

      const result = await buildGooglePart(content);

      expect(result).toEqual({
        inlineData: {
          data: mockBase64,
          mimeType: 'image/png',
        },
        thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
      });

      expect(imageToBase64Module.imageUrlToBase64).toHaveBeenCalledWith(imageUrl);
    });

    it('should throw TypeError for unsupported image URL types', async () => {
      const unsupportedImageUrl = 'unsupported://example.com/image.png';

      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: null,
        mimeType: null,
        type: 'unknown' as any,
      });

      const content: UserMessageContentPart = {
        image_url: { url: unsupportedImageUrl },
        type: 'image_url',
      };

      await expect(buildGooglePart(content)).rejects.toThrow(TypeError);
    });

    it('should handle base64 video', async () => {
      const base64Video = 'data:video/mp4;base64,mockVideoBase64Data';

      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: 'mockVideoBase64Data',
        mimeType: 'video/mp4',
        type: 'base64',
      });

      const content: UserMessageContentPart = {
        type: 'video_url',
        video_url: { url: base64Video },
      };

      const result = await buildGooglePart(content);

      expect(result).toEqual({
        inlineData: {
          data: 'mockVideoBase64Data',
          mimeType: 'video/mp4',
        },
        thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
      });
    });

    it('should return undefined for unsupported SVG image (base64)', async () => {
      const svgBase64 =
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==';

      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==',
        mimeType: 'image/svg+xml',
        type: 'base64',
      });

      const content: UserMessageContentPart = {
        image_url: { url: svgBase64 },
        type: 'image_url',
      };

      const result = await buildGooglePart(content);
      expect(result).toBeUndefined();
    });

    it('should return undefined for unsupported SVG image (URL)', async () => {
      const svgUrl = 'https://example.com/image.svg';

      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: null,
        mimeType: null,
        type: 'url',
      });

      vi.spyOn(imageToBase64Module, 'imageUrlToBase64').mockResolvedValueOnce({
        base64: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==',
        mimeType: 'image/svg+xml',
      });

      const content: UserMessageContentPart = {
        image_url: { url: svgUrl },
        type: 'image_url',
      };

      const result = await buildGooglePart(content);
      expect(result).toBeUndefined();
    });
  });

  describe('buildGoogleMessage', () => {
    it('should correctly convert assistant message', async () => {
      const message: OpenAIChatMessage = {
        content: 'Hello',
        role: 'assistant',
      };

      const converted = await buildGoogleMessage(message);

      expect(converted).toEqual({
        parts: [{ text: 'Hello', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
        role: 'model',
      });
    });

    it('should correctly convert user message', async () => {
      const message: OpenAIChatMessage = {
        content: 'Hi',
        role: 'user',
      };

      const converted = await buildGoogleMessage(message);

      expect(converted).toEqual({
        parts: [{ text: 'Hi', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
        role: 'user',
      });
    });

    it('should correctly convert message with inline base64 image parts', async () => {
      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: '...',
        mimeType: 'image/png',
        type: 'base64',
      });

      const message: OpenAIChatMessage = {
        content: [
          { text: 'Check this image:', type: 'text' },
          { image_url: { url: 'data:image/png;base64,...' }, type: 'image_url' },
        ],
        role: 'user',
      };

      const converted = await buildGoogleMessage(message);

      expect(converted).toEqual({
        parts: [
          { text: 'Check this image:', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE },
          {
            inlineData: { data: '...', mimeType: 'image/png' },
            thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
          },
        ],
        role: 'user',
      });
    });

    it('should correctly convert function call message', async () => {
      const message = {
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({ location: 'London', unit: 'celsius' }),
              name: 'get_current_weather',
            },
            id: 'call_1',
            type: 'function',
          },
        ],
      } as OpenAIChatMessage;

      const converted = await buildGoogleMessage(message);

      expect(converted).toEqual({
        parts: [
          {
            functionCall: {
              args: { location: 'London', unit: 'celsius' },
              name: 'get_current_weather',
            },
          },
        ],
        role: 'model',
      });
    });

    it('should correctly convert function call message with thoughtSignature', async () => {
      const message = {
        role: 'assistant',
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({
                language: ['JSON'],
                path: 'package.json',
                query: '"version":',
                repo: 'lobehub/lobe-chat',
              }),
              name: 'grep____searchGitHub____mcp',
            },
            id: 'grep____searchGitHub____mcp_0_6RnOMTF0',
            thoughtSignature:
              'EsUHCsIHAdHtim9/MrjP+pnhM8DVkvulyfWQVf+isXQxEAbF32gbflE1hl6Te80qtp77Ywn8opB2uhQOIH/l6SStsj3+XRy1U1DTeKtqZxDBoLP2rNK6pi3/nk0ZOQIc8f6rxB70G/zOhk7d/1XQFqhmw5H+yDVRQjGD1cNPY5ctWGxQLAIk/HMWNovUJzz2c81jGWoXu7k2vtpuur2hcAL+J79BEVUTfvU3mSiXqJFTClmFPB6Fe79i0y3TwM2XdIBxzPgVgf8B+Pnv1S6YDxHNSm46jTlXKcSw30r3ixs5xEOzerbOUW5WG9BGukw/YQVvHiuoGLIALRa2Ig7dlOMH8+o+f0mKJtyYj8yF6wyBMol+G4mhSHvQSKJLj/Z5kFHvDZKeVUEOZed6vZivYLrVezjQPXgLHJMOmbp6QrZGxqW45QxDKY5X5F8giIOM8VgsUYhDQUBown+3vvwkIBA24icDsOwdhJ/roe9GabbGfxpkSzARIFh7rSI01cRKbh6cEaVFXf2WQftPeD7dBseQLiCdUYoy4ytECrjTpknrWnVUG6Ly4SKW6uN/IJXpm9JT9GgnGLIddFtEQzm9sIKWNpGEz6++lZpiCFS6LsYSnTP3vPj/7oSABRmwWywxA8EmLh+sv+jiK5aMjFi1sTuJ0Ujsvza3/SHZKewNi9WKQUDOa9Mqtjs2YGDnJxto4l5GMUzI5vhf6/+/A5eHALfVabaFP97v8FEPrXQU94dognwx4EnNqy/KWmGIlYZYqIfjaSAy7Z74viwl+oTtL9gyyBDc/FrQvXfyrYIq8N0pkLKAEh33fa/+YVocLL1LKI9rb2bg/RRr+Ee4NyIQKhIdEJaEh74d1COd/4r06J92ThkfVo5PEVTSsr8tBKiJ5wSmX9vyhbLWzxmXoq1xfGrs8kg7NMW53XEWGlQrIVOQmUtjjjBQKj6b4rBTAO6EKk63cGFbkSPohifiUBPHbxUUPy/hf0tQpeOo3jA01AuCFLOIZ5IYJ+Rm5+aZTU3Panv+Q7Yl1w5t5swhbNZfg7MlU/sxwLijLuWDDNfw+2Zw/aa3VDPgVw6Nv2vKkHi4tUU0XlgfiQgQYUMPxpGRV837uUxvZFNep2QUlAMog5h4sMYJWIAX1kK1pzsyR/KxuCn6nUq4ovWNBQHLC4aW2ZcGgW/6CbF81F1cewUz+vWNMMkJrL0d9celGEbFuY0Q709UipaDbCg49twlnLV9XUwqC5wYTFBiJbynBDqiZAvXn2YOxNIs8CCzuu2GSCQDo09ksJy5g/o=',
            type: 'function',
          },
        ],
      } as OpenAIChatMessage;

      const converted = await buildGoogleMessage(message);

      expect(converted).toEqual({
        parts: [
          {
            functionCall: {
              args: {
                language: ['JSON'],
                path: 'package.json',
                query: '"version":',
                repo: 'lobehub/lobe-chat',
              },
              name: 'grep____searchGitHub____mcp',
            },
            thoughtSignature:
              'EsUHCsIHAdHtim9/MrjP+pnhM8DVkvulyfWQVf+isXQxEAbF32gbflE1hl6Te80qtp77Ywn8opB2uhQOIH/l6SStsj3+XRy1U1DTeKtqZxDBoLP2rNK6pi3/nk0ZOQIc8f6rxB70G/zOhk7d/1XQFqhmw5H+yDVRQjGD1cNPY5ctWGxQLAIk/HMWNovUJzz2c81jGWoXu7k2vtpuur2hcAL+J79BEVUTfvU3mSiXqJFTClmFPB6Fe79i0y3TwM2XdIBxzPgVgf8B+Pnv1S6YDxHNSm46jTlXKcSw30r3ixs5xEOzerbOUW5WG9BGukw/YQVvHiuoGLIALRa2Ig7dlOMH8+o+f0mKJtyYj8yF6wyBMol+G4mhSHvQSKJLj/Z5kFHvDZKeVUEOZed6vZivYLrVezjQPXgLHJMOmbp6QrZGxqW45QxDKY5X5F8giIOM8VgsUYhDQUBown+3vvwkIBA24icDsOwdhJ/roe9GabbGfxpkSzARIFh7rSI01cRKbh6cEaVFXf2WQftPeD7dBseQLiCdUYoy4ytECrjTpknrWnVUG6Ly4SKW6uN/IJXpm9JT9GgnGLIddFtEQzm9sIKWNpGEz6++lZpiCFS6LsYSnTP3vPj/7oSABRmwWywxA8EmLh+sv+jiK5aMjFi1sTuJ0Ujsvza3/SHZKewNi9WKQUDOa9Mqtjs2YGDnJxto4l5GMUzI5vhf6/+/A5eHALfVabaFP97v8FEPrXQU94dognwx4EnNqy/KWmGIlYZYqIfjaSAy7Z74viwl+oTtL9gyyBDc/FrQvXfyrYIq8N0pkLKAEh33fa/+YVocLL1LKI9rb2bg/RRr+Ee4NyIQKhIdEJaEh74d1COd/4r06J92ThkfVo5PEVTSsr8tBKiJ5wSmX9vyhbLWzxmXoq1xfGrs8kg7NMW53XEWGlQrIVOQmUtjjjBQKj6b4rBTAO6EKk63cGFbkSPohifiUBPHbxUUPy/hf0tQpeOo3jA01AuCFLOIZ5IYJ+Rm5+aZTU3Panv+Q7Yl1w5t5swhbNZfg7MlU/sxwLijLuWDDNfw+2Zw/aa3VDPgVw6Nv2vKkHi4tUU0XlgfiQgQYUMPxpGRV837uUxvZFNep2QUlAMog5h4sMYJWIAX1kK1pzsyR/KxuCn6nUq4ovWNBQHLC4aW2ZcGgW/6CbF81F1cewUz+vWNMMkJrL0d9celGEbFuY0Q709UipaDbCg49twlnLV9XUwqC5wYTFBiJbynBDqiZAvXn2YOxNIs8CCzuu2GSCQDo09ksJy5g/o=',
          },
        ],
        role: 'model',
      });
    });

    describe('should correctly convert function call message without thoughtSignature', () => {
      it('should add magic signature when last message is tool message', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: '<plugins>Web Browsing plugin available</plugins>',
            role: 'system',
          },
          {
            content: '杭州天气如何',
            role: 'user',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"query":"杭州天气","searchEngines":["google"]}',
                  name: 'lobe-web-browsing____search____builtin',
                },
                id: 'call_001',
                type: 'function',
              },
            ],
          },
          {
            content: 'Tool execution was aborted by user.',
            name: 'lobe-web-browsing____search____builtin',
            role: 'tool',
            tool_call_id: 'call_001',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"query":"杭州 天气","searchEngines":["bing"]}',
                  name: 'lobe-web-browsing____search____builtin',
                },
                id: 'call_002',
                type: 'function',
              },
            ],
          },
          {
            content: 'no result',
            name: 'lobe-web-browsing____search____builtin',
            role: 'tool',
            tool_call_id: 'call_002',
          },
        ];

        const contents = await buildGoogleMessages(messages);

        expect(contents).toEqual([
          {
            parts: [
              {
                text: '<plugins>Web Browsing plugin available</plugins>',
                thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
              },
            ],
            role: 'user',
          },
          {
            parts: [{ text: '杭州天气如何', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
            role: 'user',
          },
          {
            parts: [
              {
                functionCall: {
                  args: { query: '杭州天气', searchEngines: ['google'] },
                  name: 'lobe-web-browsing____search____builtin',
                },
                thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
              },
            ],
            role: 'model',
          },
          {
            parts: [
              {
                functionResponse: {
                  name: 'lobe-web-browsing____search____builtin',
                  response: { result: 'Tool execution was aborted by user.' },
                },
              },
            ],
            role: 'user',
          },
          {
            parts: [
              {
                functionCall: {
                  args: { query: '杭州 天气', searchEngines: ['bing'] },
                  name: 'lobe-web-browsing____search____builtin',
                },
                thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
              },
            ],
            role: 'model',
          },
          {
            parts: [
              {
                functionResponse: {
                  name: 'lobe-web-browsing____search____builtin',
                  response: { result: 'no result' },
                },
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should NOT add magic signature when thoughtSignature already exists', async () => {
        const existingSignature = 'existing_signature_from_model';
        const messages: OpenAIChatMessage[] = [
          {
            content: '杭州天气如何',
            role: 'user',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"query":"杭州天气","searchEngines":["google"]}',
                  name: 'lobe-web-browsing____search____builtin',
                },
                id: 'call_001',
                thoughtSignature: existingSignature,
                type: 'function',
              },
            ],
          },
          {
            content: 'Tool result',
            name: 'lobe-web-browsing____search____builtin',
            role: 'tool',
            tool_call_id: 'call_001',
          },
        ];

        const contents = await buildGoogleMessages(messages);

        expect(contents).toEqual([
          {
            parts: [{ text: '杭州天气如何', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
            role: 'user',
          },
          {
            parts: [
              {
                functionCall: {
                  args: { query: '杭州天气', searchEngines: ['google'] },
                  name: 'lobe-web-browsing____search____builtin',
                },
                // Should keep existing thoughtSignature, not add magic signature
                thoughtSignature: existingSignature,
              },
            ],
            role: 'model',
          },
          {
            parts: [
              {
                functionResponse: {
                  name: 'lobe-web-browsing____search____builtin',
                  response: { result: 'Tool result' },
                },
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should add magic signature only after last user message in multi-turn scenario', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: 'First question',
            role: 'user',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"query":"first"}',
                  name: 'search',
                },
                id: 'call_001',
                type: 'function',
              },
            ],
          },
          {
            content: 'First result',
            name: 'search',
            role: 'tool',
            tool_call_id: 'call_001',
          },
          {
            content: 'Second question',
            role: 'user',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"query":"second"}',
                  name: 'search',
                },
                id: 'call_002',
                type: 'function',
              },
            ],
          },
          {
            content: 'Second result',
            name: 'search',
            role: 'tool',
            tool_call_id: 'call_002',
          },
        ];

        const contents = await buildGoogleMessages(messages);

        expect(contents).toEqual([
          {
            parts: [{ text: 'First question', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
            role: 'user',
          },
          {
            parts: [
              {
                functionCall: {
                  args: { query: 'first' },
                  name: 'search',
                },
                // No magic signature for this one (before last user message)
              },
            ],
            role: 'model',
          },
          {
            parts: [
              {
                functionResponse: {
                  name: 'search',
                  response: { result: 'First result' },
                },
              },
            ],
            role: 'user',
          },
          {
            parts: [{ text: 'Second question', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
            role: 'user',
          },
          {
            parts: [
              {
                functionCall: {
                  args: { query: 'second' },
                  name: 'search',
                },
                // Magic signature added (after last user message)
                thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
              },
            ],
            role: 'model',
          },
          {
            parts: [
              {
                functionResponse: {
                  name: 'search',
                  response: { result: 'Second result' },
                },
              },
            ],
            role: 'user',
          },
        ]);
      });

      it('should NOT add magic signature when last message is user text message', async () => {
        const messages: OpenAIChatMessage[] = [
          {
            content: '<plugins>Web Browsing plugin available</plugins>',
            role: 'system',
          },
          {
            content: '杭州天气如何',
            role: 'user',
          },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{"query":"杭州天气","searchEngines":["google"]}',
                  name: 'lobe-web-browsing____search____builtin',
                },
                id: 'call_001',
                type: 'function',
              },
            ],
          },
          {
            content: 'Tool execution was aborted by user.',
            name: 'lobe-web-browsing____search____builtin',
            role: 'tool',
            tool_call_id: 'call_001',
          },
          {
            content: 'Please try again',
            role: 'user',
          },
        ];

        const contents = await buildGoogleMessages(messages);

        expect(contents).toEqual([
          {
            parts: [
              {
                text: '<plugins>Web Browsing plugin available</plugins>',
                thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
              },
            ],
            role: 'user',
          },
          {
            parts: [{ text: '杭州天气如何', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
            role: 'user',
          },
          {
            parts: [
              {
                functionCall: {
                  args: { query: '杭州天气', searchEngines: ['google'] },
                  name: 'lobe-web-browsing____search____builtin',
                },
                // No thoughtSignature should be added when last message is user text
              },
            ],
            role: 'model',
          },
          {
            parts: [
              {
                functionResponse: {
                  name: 'lobe-web-browsing____search____builtin',
                  response: { result: 'Tool execution was aborted by user.' },
                },
              },
            ],
            role: 'user',
          },
          {
            parts: [{ text: 'Please try again', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
            role: 'user',
          },
        ]);
      });
    });

    it('should correctly handle empty content', async () => {
      const message: OpenAIChatMessage = {
        content: '' as any, // explicitly set as empty string
        role: 'user',
      };

      const converted = await buildGoogleMessage(message);

      expect(converted).toEqual({
        parts: [{ text: '', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
        role: 'user',
      });
    });

    it('should correctly convert tool response message', async () => {
      const toolCallNameMap = new Map<string, string>([['call_1', 'get_current_weather']]);

      const message: OpenAIChatMessage = {
        content: '{"success":true,"data":{"temperature":"14°C"}}',
        name: 'get_current_weather',
        role: 'tool',
        tool_call_id: 'call_1',
      };

      const converted = await buildGoogleMessage(message, toolCallNameMap);

      expect(converted).toEqual({
        parts: [
          {
            functionResponse: {
              name: 'get_current_weather',
              response: { result: '{"success":true,"data":{"temperature":"14°C"}}' },
            },
          },
        ],
        role: 'user',
      });
    });
  });

  describe('buildGoogleMessages', () => {
    it('get default result with gemini-pro', async () => {
      const messages: OpenAIChatMessage[] = [{ content: 'Hello', role: 'user' }];

      const contents = await buildGoogleMessages(messages);

      expect(contents).toHaveLength(1);
      expect(contents).toEqual([
        {
          parts: [{ text: 'Hello', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'user',
        },
      ]);
    });

    it('should not modify the length if model is gemini-1.5-pro', async () => {
      const messages: OpenAIChatMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
      ];

      const contents = await buildGoogleMessages(messages);

      expect(contents).toHaveLength(2);
      expect(contents).toEqual([
        {
          parts: [{ text: 'Hello', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'user',
        },
        {
          parts: [{ text: 'Hi', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'model',
        },
      ]);
    });

    it('should use specified model when images are included in messages', async () => {
      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: '...',
        mimeType: 'image/png',
        type: 'base64',
      });

      const messages: OpenAIChatMessage[] = [
        {
          content: [
            { text: 'Hello', type: 'text' },
            { image_url: { url: 'data:image/png;base64,...' }, type: 'image_url' },
          ],
          role: 'user',
        },
      ];

      const contents = await buildGoogleMessages(messages);

      expect(contents).toHaveLength(1);
      expect(contents).toEqual([
        {
          parts: [
            { text: 'Hello', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE },
            {
              inlineData: { data: '...', mimeType: 'image/png' },
              thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
            },
          ],
          role: 'user',
        },
      ]);
    });

    it('should correctly convert function response message', async () => {
      const messages: OpenAIChatMessage[] = [
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({ location: 'London', unit: 'celsius' }),
                name: 'get_current_weather',
              },
              id: 'call_1',
              type: 'function',
            },
          ],
        },
        {
          content: '{"success":true,"data":{"temperature":"14°C"}}',
          name: 'get_current_weather',
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ];

      const contents = await buildGoogleMessages(messages);

      expect(contents).toHaveLength(2);
      expect(contents).toEqual([
        {
          parts: [
            {
              functionCall: {
                args: { location: 'London', unit: 'celsius' },
                name: 'get_current_weather',
              },
              thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE,
            },
          ],
          role: 'model',
        },
        {
          parts: [
            {
              functionResponse: {
                name: 'get_current_weather',
                response: { result: '{"success":true,"data":{"temperature":"14°C"}}' },
              },
            },
          ],
          role: 'user',
        },
      ]);
    });

    it('should filter out function role messages', async () => {
      const messages: OpenAIChatMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: 'function result', name: 'test_func', role: 'function' },
        { content: 'Hi', role: 'assistant' },
      ];

      const contents = await buildGoogleMessages(messages);

      expect(contents).toHaveLength(2);
      expect(contents).toEqual([
        {
          parts: [{ text: 'Hello', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'user',
        },
        {
          parts: [{ text: 'Hi', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'model',
        },
      ]);
    });

    it('should filter out empty messages', async () => {
      const messages: OpenAIChatMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: [], role: 'user' },
        { content: 'Hi', role: 'assistant' },
      ];

      const contents = await buildGoogleMessages(messages);

      expect(contents).toHaveLength(2);
      expect(contents).toEqual([
        {
          parts: [{ text: 'Hello', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'user',
        },
        {
          parts: [{ text: 'Hi', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'model',
        },
      ]);
    });

    it('should correctly convert full conversation with thoughtSignature', async () => {
      const messages: OpenAIChatMessage[] = [
        { content: 'system prompt', role: 'system' },
        { content: 'LobeChat 最新版本', role: 'user' },
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  language: ['JSON'],
                  path: 'package.json',
                  query: '"version":',
                  repo: 'lobehub/lobe-chat',
                }),
                name: 'grep____searchGitHub____mcp',
              },
              id: 'grep____searchGitHub____mcp_0_6RnOMTF0',
              thoughtSignature: 'test-signature',
              type: 'function',
            },
          ],
        },
        {
          content: '',
          name: 'grep____searchGitHub____mcp',
          role: 'tool',
          tool_call_id: 'grep____searchGitHub____mcp_0_6RnOMTF0',
        },
      ];

      const contents = await buildGoogleMessages(messages);

      expect(contents).toEqual([
        {
          parts: [{ text: 'system prompt', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'user',
        },
        {
          parts: [{ text: 'LobeChat 最新版本', thoughtSignature: GEMINI_MAGIC_THOUGHT_SIGNATURE }],
          role: 'user',
        },
        {
          parts: [
            {
              functionCall: {
                args: {
                  language: ['JSON'],
                  path: 'package.json',
                  query: '"version":',
                  repo: 'lobehub/lobe-chat',
                },
                name: 'grep____searchGitHub____mcp',
              },
              thoughtSignature: 'test-signature',
            },
          ],
          role: 'model',
        },
        {
          parts: [
            {
              functionResponse: {
                name: 'grep____searchGitHub____mcp',
                response: { result: '' },
              },
            },
          ],
          role: 'user',
        },
      ]);
    });
  });

  describe('buildGoogleTool', () => {
    it('should correctly convert ChatCompletionTool to FunctionDeclaration', () => {
      const tool: ChatCompletionTool = {
        function: {
          description: 'A test tool',
          name: 'testTool',
          parameters: {
            properties: {
              param1: { type: 'string' },
              param2: { type: 'number' },
            },
            required: ['param1'],
            type: 'object',
          },
        },
        type: 'function',
      };

      const result = buildGoogleTool(tool);

      expect(result).toEqual({
        description: 'A test tool',
        name: 'testTool',
        parameters: {
          description: undefined,
          properties: {
            param1: { type: 'string' },
            param2: { type: 'number' },
          },
          required: ['param1'],
          type: SchemaType.OBJECT,
        },
      });
    });

    it('should handle tools with empty parameters', () => {
      const tool: ChatCompletionTool = {
        function: {
          description: 'A simple function with no parameters',
          name: 'simple_function',
          parameters: {
            properties: {},
            type: 'object',
          },
        },
        type: 'function',
      };

      const result = buildGoogleTool(tool);

      // Should use dummy property for empty parameters
      expect(result).toEqual({
        description: 'A simple function with no parameters',
        name: 'simple_function',
        parameters: {
          description: undefined,
          properties: { dummy: { type: 'string' } },
          required: undefined,
          type: SchemaType.OBJECT,
        },
      });
    });

    it('should preserve parameter description', () => {
      const tool: ChatCompletionTool = {
        function: {
          description: 'A test tool',
          name: 'testTool',
          parameters: {
            description: 'Test parameters',
            properties: {
              param1: { type: 'string' },
            },
            type: 'object',
          },
        },
        type: 'function',
      };

      const result = buildGoogleTool(tool);

      expect(result.parameters?.description).toBe('Test parameters');
    });

    it('should convert const to enum for Google compatibility', () => {
      const tool: ChatCompletionTool = {
        function: {
          description: 'A tool with const values',
          name: 'constTool',
          parameters: {
            properties: {
              action: { const: 'insert', type: 'string' },
              nested: {
                properties: {
                  operation: { const: 'create', type: 'string' },
                },
                type: 'object',
              },
            },
            type: 'object',
          },
        },
        type: 'function',
      };

      const result = buildGoogleTool(tool);

      // const should be converted to enum with single value
      expect(result.parameters?.properties).toEqual({
        action: { enum: ['insert'], type: 'string' },
        nested: {
          properties: {
            operation: { enum: ['create'], type: 'string' },
          },
          type: 'object',
        },
      });
    });

    it('should handle oneOf with const values (like page-agent modifyNodes)', () => {
      const tool: ChatCompletionTool = {
        function: {
          description: 'Modify nodes operation',
          name: 'modifyNodes',
          parameters: {
            properties: {
              operations: {
                items: {
                  oneOf: [
                    {
                      properties: {
                        action: { const: 'insert', type: 'string' },
                        beforeId: { type: 'string' },
                      },
                      type: 'object',
                    },
                    {
                      properties: {
                        action: { const: 'modify', type: 'string' },
                        content: { type: 'string' },
                      },
                      type: 'object',
                    },
                  ],
                },
                type: 'array',
              },
            },
            type: 'object',
          },
        },
        type: 'function',
      };

      const result = buildGoogleTool(tool);

      // All const values in nested oneOf should be converted to enum
      const operations = result.parameters?.properties?.operations as any;
      expect(operations.items.oneOf[0].properties.action).toEqual({
        enum: ['insert'],
        type: 'string',
      });
      expect(operations.items.oneOf[1].properties.action).toEqual({
        enum: ['modify'],
        type: 'string',
      });
    });

    it('should filter null values from enum arrays for Google compatibility', () => {
      const tool: ChatCompletionTool = {
        function: {
          description: 'A tool with enum containing null',
          name: 'enumTool',
          parameters: {
            properties: {
              memoryType: {
                enum: ['short_term', 'long_term', null, 'working'],
                type: 'string',
              },
              nested: {
                properties: {
                  status: {
                    enum: [null, 'active', 'inactive', null],
                    type: 'string',
                  },
                },
                type: 'object',
              },
            },
            type: 'object',
          },
        },
        type: 'function',
      };

      const result = buildGoogleTool(tool);

      // null values should be filtered from enum arrays
      expect(result.parameters?.properties).toEqual({
        memoryType: {
          enum: ['short_term', 'long_term', 'working'],
          type: 'string',
        },
        nested: {
          properties: {
            status: {
              enum: ['active', 'inactive'],
              type: 'string',
            },
          },
          type: 'object',
        },
      });
    });

    it('should handle enum with only null values', () => {
      const tool: ChatCompletionTool = {
        function: {
          description: 'A tool with enum containing only null',
          name: 'nullEnumTool',
          parameters: {
            properties: {
              value: {
                enum: [null],
                type: 'string',
              },
            },
            type: 'object',
          },
        },
        type: 'function',
      };

      const result = buildGoogleTool(tool);

      // When enum only contains null, the enum property should be removed
      expect(result.parameters?.properties?.value).toEqual({
        type: 'string',
      });
    });
  });

  describe('buildGoogleTools', () => {
    it('should return undefined when tools is undefined or empty', () => {
      expect(buildGoogleTools(undefined)).toBeUndefined();
      expect(buildGoogleTools([])).toBeUndefined();
    });

    it('should correctly convert ChatCompletionTool array to GoogleFunctionCallTool', () => {
      const tools: ChatCompletionTool[] = [
        {
          function: {
            description: 'A test tool',
            name: 'testTool',
            parameters: {
              properties: {
                param1: { type: 'string' },
                param2: { type: 'number' },
              },
              required: ['param1'],
              type: 'object',
            },
          },
          type: 'function',
        },
      ];

      const googleTools = buildGoogleTools(tools);

      expect(googleTools).toHaveLength(1);
      expect(googleTools![0].functionDeclarations).toHaveLength(1);
      expect(googleTools![0].functionDeclarations![0]).toEqual({
        description: 'A test tool',
        name: 'testTool',
        parameters: {
          description: undefined,
          properties: {
            param1: { type: 'string' },
            param2: { type: 'number' },
          },
          required: ['param1'],
          type: SchemaType.OBJECT,
        },
      });
    });

    it('should handle multiple tools', () => {
      const tools: ChatCompletionTool[] = [
        {
          function: {
            description: 'Get weather information',
            name: 'get_weather',
            parameters: {
              properties: {
                city: { type: 'string' },
                unit: { type: 'string' },
              },
              required: ['city'],
              type: 'object',
            },
          },
          type: 'function',
        },
        {
          function: {
            description: 'Get current time',
            name: 'get_time',
            parameters: {
              properties: {
                timezone: { type: 'string' },
              },
              required: ['timezone'],
              type: 'object',
            },
          },
          type: 'function',
        },
      ];

      const googleTools = buildGoogleTools(tools);

      expect(googleTools).toHaveLength(1);
      expect(googleTools![0].functionDeclarations).toHaveLength(2);
      expect(googleTools![0].functionDeclarations![0].name).toBe('get_weather');
      expect(googleTools![0].functionDeclarations![1].name).toBe('get_time');
    });
  });
});
