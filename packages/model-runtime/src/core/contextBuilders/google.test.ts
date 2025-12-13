// @vitest-environment node
import { Type as SchemaType } from '@google/genai';
import * as imageToBase64Module from '@lobechat/utils';
import { describe, expect, it, vi } from 'vitest';

import { ChatCompletionTool, OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { parseDataUri } from '../../utils/uriParser';
import {
  buildGoogleMessage,
  buildGoogleMessages,
  buildGooglePart,
  buildGoogleTool,
  buildGoogleTools,
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

      expect(result).toEqual({ text: 'Hello' });
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
      });
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
        parts: [{ text: 'Hello' }],
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
        parts: [{ text: 'Hi' }],
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
          { text: 'Check this image:' },
          { inlineData: { data: '...', mimeType: 'image/png' } },
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

    it('should correctly handle empty content', async () => {
      const message: OpenAIChatMessage = {
        content: '' as any, // explicitly set as empty string
        role: 'user',
      };

      const converted = await buildGoogleMessage(message);

      expect(converted).toEqual({
        parts: [{ text: '' }],
        role: 'user',
      });
    });

    it('should correctly convert tool response message', async () => {
      const toolCallNameMap = new Map<string, string>();
      toolCallNameMap.set('call_1', 'get_current_weather');

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
      expect(contents).toEqual([{ parts: [{ text: 'Hello' }], role: 'user' }]);
    });

    it('should not modify the length if model is gemini-1.5-pro', async () => {
      const messages: OpenAIChatMessage[] = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi', role: 'assistant' },
      ];

      const contents = await buildGoogleMessages(messages);

      expect(contents).toHaveLength(2);
      expect(contents).toEqual([
        { parts: [{ text: 'Hello' }], role: 'user' },
        { parts: [{ text: 'Hi' }], role: 'model' },
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
          parts: [{ text: 'Hello' }, { inlineData: { data: '...', mimeType: 'image/png' } }],
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
        { parts: [{ text: 'Hello' }], role: 'user' },
        { parts: [{ text: 'Hi' }], role: 'model' },
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
        { parts: [{ text: 'Hello' }], role: 'user' },
        { parts: [{ text: 'Hi' }], role: 'model' },
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
