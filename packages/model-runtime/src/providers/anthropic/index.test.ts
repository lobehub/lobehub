// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDefaultAnthropicPayload } from '../../core/anthropicCompatibleFactory';
import * as anthropicHelpers from '../../core/contextBuilders/anthropic';
import type { ChatCompletionTool, ChatStreamPayload } from '../../types/chat';
import * as debugStreamModule from '../../utils/debugStream';
import { LobeAnthropicAI } from './index';

const provider = 'anthropic';

const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => { });

let instance: InstanceType<typeof LobeAnthropicAI>;

beforeEach(() => {
  instance = new LobeAnthropicAI({ apiKey: 'test' });

  // Use vi.spyOn to mock the Anthropic messages.create call.
  vi.spyOn(instance['client'].messages, 'create').mockResolvedValue(new ReadableStream() as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeAnthropicAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', async () => {
      const instance = new LobeAnthropicAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeAnthropicAI);
      expect(instance.baseURL).toBe('https://api.anthropic.com');
    });

    it('should correctly initialize with a baseURL', async () => {
      const instance = new LobeAnthropicAI({
        apiKey: 'test_api_key',
        baseURL: 'https://api.anthropic.proxy',
      });
      expect(instance).toBeInstanceOf(LobeAnthropicAI);
      expect(instance.baseURL).toBe('https://api.anthropic.proxy');
    });

    it('should correctly initialize with different id', async () => {
      const instance = new LobeAnthropicAI({
        apiKey: 'test_api_key',
        id: 'abc',
      });
      expect(instance).toBeInstanceOf(LobeAnthropicAI);
      expect(instance['id']).toBe('abc');
    });
  });

  describe('chat', () => {
    it('should return a StreamingTextResponse on successful API call', async () => {
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-3-haiku-20240307',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
    });

    it('should handle text messages correctly', async () => {
      // Arrange
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Hello, world!');
          controller.close();
        },
      });
      const mockResponse = Promise.resolve(mockStream);
      (instance['client'].messages.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-3-haiku-20240307',
        temperature: 0,
        top_p: 1,
      });

      // Assert
      expect(instance['client'].messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096,
          messages: [
            {
              content: [{ cache_control: { type: 'ephemeral' }, text: 'Hello', type: 'text' }],
              role: 'user',
            },
          ],
          model: 'claude-3-haiku-20240307',
          stream: true,
          temperature: 0,
          top_p: 1,
        }),
        expect.objectContaining({}),
      );
      expect(result).toBeInstanceOf(Response);
    });

    it('should handle system prompt correctly', async () => {
      // Arrange
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Hello, world!');
          controller.close();
        },
      });
      const mockResponse = Promise.resolve(mockStream);
      (instance['client'].messages.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        messages: [
          { content: 'You are an awesome greeter', role: 'system' },
          { content: 'Hello', role: 'user' },
        ],
        model: 'claude-3-7-sonnet-20250219',
        temperature: 0,
      });

      // Assert
      expect(instance['client'].messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 64000,
          messages: [
            {
              content: [{ cache_control: { type: 'ephemeral' }, text: 'Hello', type: 'text' }],
              role: 'user',
            },
          ],
          model: 'claude-3-7-sonnet-20250219',
          stream: true,
          system: [
            {
              cache_control: { type: 'ephemeral' },
              type: 'text',
              text: 'You are an awesome greeter',
            },
          ],
          temperature: 0,
          metadata: undefined,
          tools: undefined,
          top_p: undefined,
        }),
        expect.objectContaining({ signal: undefined }),
      );
      expect(result).toBeInstanceOf(Response);
    });

    it('should call Anthropic API with supported opions in streaming mode', async () => {
      // Arrange
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Hello, world!');
          controller.close();
        },
      });
      const mockResponse = Promise.resolve(mockStream);
      (instance['client'].messages.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        max_tokens: 2048,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-3-haiku-20240307',
        temperature: 0.5,
        top_p: 1,
      });

      // Assert
      expect(instance['client'].messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2048,
          messages: [
            {
              content: [{ cache_control: { type: 'ephemeral' }, text: 'Hello', type: 'text' }],
              role: 'user',
            },
          ],
          model: 'claude-3-haiku-20240307',
          stream: true,
          temperature: 0.25,
          top_p: 1,
        }),
        expect.objectContaining({}),
      );
      expect(result).toBeInstanceOf(Response);
    });

    it('should call Anthropic API without unsupported opions', async () => {
      // Arrange
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Hello, world!');
          controller.close();
        },
      });
      const mockResponse = Promise.resolve(mockStream);
      (instance['client'].messages.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        frequency_penalty: 0.5, // Unsupported option
        max_tokens: 2048,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-3-haiku-20240307',
        presence_penalty: 0.5,
        temperature: 0.5,
        top_p: 1,
      });

      // Assert
      expect(instance['client'].messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2048,
          messages: [
            {
              content: [{ cache_control: { type: 'ephemeral' }, text: 'Hello', type: 'text' }],
              role: 'user',
            },
          ],
          model: 'claude-3-haiku-20240307',
          stream: true,
          temperature: 0.25,
          top_p: 1,
        }),
        expect.objectContaining({}),
      );
      expect(result).toBeInstanceOf(Response);
    });

    it('should call debugStream in DEBUG mode', async () => {
      // Arrange
      const mockProdStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Hello, world!');
          controller.close();
        },
      }) as any;
      const mockDebugStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Debug stream content');
          controller.close();
        },
      }) as any;
      mockDebugStream.toReadableStream = () => mockDebugStream;

      (instance['client'].messages.create as Mock).mockResolvedValue({
        tee: () => [mockProdStream, { toReadableStream: () => mockDebugStream }],
      });

      const originalDebugValue = process.env.DEBUG_ANTHROPIC_CHAT_COMPLETION;

      process.env.DEBUG_ANTHROPIC_CHAT_COMPLETION = '1';
      vi.spyOn(debugStreamModule, 'debugStream').mockImplementation(() => Promise.resolve());

      // Act
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-3-haiku-20240307',
        temperature: 0,
      });

      // Assert
      expect(debugStreamModule.debugStream).toHaveBeenCalled();

      // Cleanup
      process.env.DEBUG_ANTHROPIC_CHAT_COMPLETION = originalDebugValue;
    });

    describe('chat with tools', () => {
      it('should call tools when tools are provided', async () => {
        // Arrange
        const tools: ChatCompletionTool[] = [
          { function: { name: 'tool1', description: 'desc1' }, type: 'function' },
        ];
        const spyOn = vi.spyOn(anthropicHelpers, 'buildAnthropicTools');

        // Act
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 1,
          tools,
        });

        // Assert
        expect(instance['client'].messages.create).toHaveBeenCalled();
        expect(spyOn).toHaveBeenCalledWith(
          [{ function: { name: 'tool1', description: 'desc1' }, type: 'function' }],
          { enabledContextCaching: true },
        );
      });

      it('should build payload with tools and web search enabled', async () => {
        const tools: ChatCompletionTool[] = [
          { function: { name: 'tool1', description: 'desc1' }, type: 'function' },
        ];

        const mockAnthropicTools = [{ name: 'tool1', description: 'desc1' }];

        vi.spyOn(anthropicHelpers, 'buildAnthropicTools').mockReturnValue(
          mockAnthropicTools as any,
        );

        const payload: ChatStreamPayload = {
          messages: [{ content: 'Search and get info', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.5,
          tools,
          enabledSearch: true,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(anthropicHelpers.buildAnthropicTools).toHaveBeenCalledWith(tools, {
          enabledContextCaching: true,
        });

        // Should include both the converted tools and web search tool
        expect(result.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'tool1' }),
            expect.objectContaining({ name: 'web_search', type: 'web_search_20250305' }),
          ]),
        );
      });

      it('should build payload with web search enabled but no other tools', async () => {
        vi.spyOn(anthropicHelpers, 'buildAnthropicTools').mockReturnValue(undefined);

        const payload: ChatStreamPayload = {
          messages: [{ content: 'Search for information', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.5,
          enabledSearch: true,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(anthropicHelpers.buildAnthropicTools).toHaveBeenCalledWith(undefined, {
          enabledContextCaching: true,
        });

        // Should only include web search tool
        expect(result.tools).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'web_search', type: 'web_search_20250305' }),
          ]),
        );
      });
    });

    describe('Error', () => {
      it('should throw InvalidAnthropicAPIKey error on API_KEY_INVALID error', async () => {
        // Arrange
        const apiError = {
          status: 401,
          error: {
            type: 'error',
            error: {
              type: 'authentication_error',
              message: 'invalid x-api-key',
            },
          },
        };
        (instance['client'].messages.create as Mock).mockRejectedValue(apiError);

        try {
          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-3-haiku-20240307',
            temperature: 0,
          });
        } catch (e) {
          // Assert
          expect(e).toEqual({
            endpoint: 'https://api.anthropic.com',
            error: apiError,
            errorType: invalidErrorType,
            provider,
          });
        }
      });
      it('should throw BizError error', async () => {
        // Arrange
        const apiError = {
          status: 529,
          error: {
            type: 'error',
            error: {
              type: 'overloaded_error',
              message: "Anthropic's API is temporarily overloaded",
            },
          },
        };
        (instance['client'].messages.create as Mock).mockRejectedValue(apiError);

        try {
          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-3-haiku-20240307',
            temperature: 0,
          });
        } catch (e) {
          // Assert
          expect(e).toEqual({
            endpoint: 'https://api.anthropic.com',
            error: apiError.error.error,
            errorType: bizErrorType,
            provider,
          });
        }
      });

      it('should throw InvalidAnthropicAPIKey if no apiKey is provided', async () => {
        try {
          new LobeAnthropicAI({});
        } catch (e) {
          expect(e).toEqual({ errorType: invalidErrorType });
        }
      });
    });

    describe('Error handling', () => {
      it('should throw LocationNotSupportError on 403 error', async () => {
        // Arrange
        const apiError = { status: 403 };
        (instance['client'].messages.create as Mock).mockRejectedValue(apiError);

        // Act & Assert
        await expect(
          instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-3-haiku-20240307',
            temperature: 1,
          }),
        ).rejects.toEqual({
          endpoint: 'https://api.anthropic.com',
          error: apiError,
          errorType: 'LocationNotSupportError',
          provider,
        });
      });

      it('should throw AnthropicBizError on other error status codes', async () => {
        // Arrange
        const apiError = { status: 500 };
        (instance['client'].messages.create as Mock).mockRejectedValue(apiError);

        // Act & Assert
        await expect(
          instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-3-haiku-20240307',
            temperature: 1,
          }),
        ).rejects.toEqual({
          endpoint: 'https://api.anthropic.com',
          error: apiError,
          errorType: bizErrorType,
          provider,
        });
      });

      it('should desensitize custom baseURL in error message', async () => {
        // Arrange
        const apiError = { status: 401 };
        const customInstance = new LobeAnthropicAI({
          apiKey: 'test',
          baseURL: 'https://api.custom.com/v1',
        });
        vi.spyOn(customInstance['client'].messages, 'create').mockRejectedValue(apiError);

        // Act & Assert
        await expect(
          customInstance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-3-haiku-20240307',
            temperature: 0,
          }),
        ).rejects.toEqual({
          endpoint: 'https://api.cu****om.com/v1',
          error: apiError,
          errorType: invalidErrorType,
          provider,
        });
      });
    });

    describe('Options', () => {
      it('should pass signal to API call', async () => {
        // Arrange
        const controller = new AbortController();

        // Act
        await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-3-haiku-20240307',
            temperature: 1,
          },
          { signal: controller.signal },
        );

        // Assert
        expect(instance['client'].messages.create).toHaveBeenCalledWith(
          expect.objectContaining({}),
          expect.objectContaining({ signal: controller.signal }),
        );
      });

      it('should apply callback to the returned stream', async () => {
        // Arrange
        const callback = vi.fn();

        // Act
        await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-3-haiku-20240307',
            temperature: 0,
          },
          {
            callback: { onStart: callback },
          },
        );

        // Assert
        expect(callback).toHaveBeenCalled();
      });

      it('should set headers on the response', async () => {
        // Arrange
        const headers = { 'X-Test-Header': 'test' };

        // Act
        const result = await instance.chat(
          {
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-3-haiku-20240307',
            temperature: 1,
          },
          { headers },
        );

        // Assert
        expect(result.headers.get('X-Test-Header')).toBe('test');
      });
    });

    describe('Edge cases', () => {
      it('should handle empty messages array', async () => {
        // Act & Assert
        await expect(
          instance.chat({
            messages: [],
            model: 'claude-3-haiku-20240307',
            temperature: 1,
          }),
        ).resolves.toBeInstanceOf(Response);
      });
    });

    describe('buildDefaultAnthropicPayload', () => {
      it('should correctly build payload with user messages only', async () => {
        const payload: ChatStreamPayload = {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.5,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result).toEqual(
          expect.objectContaining({
            max_tokens: 4096,
            messages: [
              {
                content: [{ cache_control: { type: 'ephemeral' }, text: 'Hello', type: 'text' }],
                role: 'user',
              },
            ],
            model: 'claude-3-haiku-20240307',
            temperature: 0.25,
          }),
        );
      });

      it('should correctly build payload with system message', async () => {
        const payload: ChatStreamPayload = {
          messages: [
            { content: 'You are a helpful assistant', role: 'system' },
            { content: 'Hello', role: 'user' },
          ],
          model: 'claude-3-haiku-20240307',
          temperature: 0.7,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result).toEqual(
          expect.objectContaining({
            max_tokens: 4096,
            messages: [
              {
                content: [{ cache_control: { type: 'ephemeral' }, text: 'Hello', type: 'text' }],
                role: 'user',
              },
            ],
            model: 'claude-3-haiku-20240307',
            system: [
              {
                cache_control: { type: 'ephemeral' },
                text: 'You are a helpful assistant',
                type: 'text',
              },
            ],
            temperature: 0.35,
          }),
        );
      });

      it('should correctly build payload with tools', async () => {
        const tools: ChatCompletionTool[] = [
          { function: { name: 'tool1', description: 'desc1' }, type: 'function' },
        ];

        const spyOn = vi.spyOn(anthropicHelpers, 'buildAnthropicTools').mockReturnValueOnce([
          {
            name: 'tool1',
            description: 'desc1',
          },
        ] as any);

        const payload: ChatStreamPayload = {
          messages: [{ content: 'Use a tool', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.8,
          tools,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result).toEqual(
          expect.objectContaining({
            max_tokens: 4096,
            messages: [
              {
                content: [
                  { cache_control: { type: 'ephemeral' }, text: 'Use a tool', type: 'text' },
                ],
                role: 'user',
              },
            ],
            model: 'claude-3-haiku-20240307',
            temperature: 0.4,
            tools: [{ name: 'tool1', description: 'desc1' }],
          }),
        );

        expect(spyOn).toHaveBeenCalledWith(tools, {
          enabledContextCaching: true,
        });
      });

      it('should correctly build payload with thinking mode enabled', async () => {
        const payload: ChatStreamPayload = {
          messages: [{ content: 'Solve this problem', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.9,
          thinking: { type: 'enabled', budget_tokens: 0 },
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result).toEqual({
          max_tokens: 4096,
          messages: [
            {
              content: [
                { cache_control: { type: 'ephemeral' }, text: 'Solve this problem', type: 'text' },
              ],
              role: 'user',
            },
          ],
          model: 'claude-3-haiku-20240307',
          system: undefined,
          thinking: { type: 'enabled', budget_tokens: 1024 },
          tools: undefined,
        });
      });

      it('should correctly build payload with adaptive thinking and effort', async () => {
        const payload: ChatStreamPayload = {
          max_tokens: 16000,
          messages: [{ content: 'Solve this problem', role: 'user' }],
          model: 'claude-opus-4-6',
          effort: 'high',
          thinking: { type: 'adaptive', budget_tokens: 0 },
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result).toEqual({
          max_tokens: 16000,
          messages: [
            {
              content: [
                { cache_control: { type: 'ephemeral' }, text: 'Solve this problem', type: 'text' },
              ],
              role: 'user',
            },
          ],
          model: 'claude-opus-4-6',
          output_config: { effort: 'high' },
          system: undefined,
          thinking: { type: 'adaptive' },
          tools: undefined,
        });
      });

      it('should respect max_tokens in thinking mode when provided', async () => {
        const payload: ChatStreamPayload = {
          max_tokens: 1000,
          messages: [{ content: 'Solve this problem', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.7,
          thinking: { type: 'enabled', budget_tokens: 0 },
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result).toEqual({
          max_tokens: 1000,
          messages: [
            {
              content: [
                { cache_control: { type: 'ephemeral' }, text: 'Solve this problem', type: 'text' },
              ],
              role: 'user',
            },
          ],
          model: 'claude-3-haiku-20240307',
          system: undefined,
          thinking: { type: 'enabled', budget_tokens: 999 },
          tools: undefined,
        });
      });

      it('should use budget_tokens in thinking mode when provided', async () => {
        const payload: ChatStreamPayload = {
          max_tokens: 1000,
          messages: [{ content: 'Solve this problem', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.5,
          thinking: { type: 'enabled', budget_tokens: 2000 },
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result).toEqual({
          max_tokens: 1000,
          messages: [
            {
              content: [
                { cache_control: { type: 'ephemeral' }, text: 'Solve this problem', type: 'text' },
              ],
              role: 'user',
            },
          ],
          model: 'claude-3-haiku-20240307',
          system: undefined,
          thinking: { type: 'enabled', budget_tokens: 999 },
          tools: undefined,
        });
      });

      it('should cap max_tokens at 64000 in thinking mode', async () => {
        const payload: ChatStreamPayload = {
          max_tokens: 10000,
          messages: [{ content: 'Solve this problem', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.6,
          thinking: { type: 'enabled', budget_tokens: 60000 },
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result).toEqual({
          max_tokens: 10000,
          messages: [
            {
              content: [
                { cache_control: { type: 'ephemeral' }, text: 'Solve this problem', type: 'text' },
              ],
              role: 'user',
            },
          ],
          model: 'claude-3-haiku-20240307',
          system: undefined,
          thinking: { type: 'enabled', budget_tokens: 9999 },
          tools: undefined,
        });
      });

      it('should set correct max_tokens based on model for claude-3 models', async () => {
        const payload: ChatStreamPayload = {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.7,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result.max_tokens).toBe(4096);
      });

      it('should respect max_tokens when explicitly provided', async () => {
        const payload: ChatStreamPayload = {
          max_tokens: 2000,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.7,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result.max_tokens).toBe(2000);
      });

      it('should correctly handle temperature scaling', async () => {
        const payload: ChatStreamPayload = {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 1,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result.temperature).toBe(0.5); // Anthropic uses 0-1 scale, so divide by 2
      });

      it('should not include temperature when not provided in payload', async () => {
        // We need to create a partial payload without temperature
        // but since the type requires it, we'll use type assertion
        const partialPayload = {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
        } as ChatStreamPayload;

        // Delete the temperature property to simulate it not being provided
        delete (partialPayload as any).temperature;

        const result = await buildDefaultAnthropicPayload(partialPayload);

        expect(result.temperature).toBeUndefined();
      });

      it('should not include top_p when thinking is enabled', async () => {
        const payload: ChatStreamPayload = {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.7,
          thinking: { type: 'enabled', budget_tokens: 0 },
          top_p: 0.9,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result.top_p).toBeUndefined();
      });

      it('should include top_p when thinking is not enabled', async () => {
        const payload: ChatStreamPayload = {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.7,
          top_p: 0.9,
        };

        const result = await buildDefaultAnthropicPayload(payload);

        expect(result.top_p).toBe(0.9);
      });

      it('should handle thinking with type disabled', async () => {
        const payload: ChatStreamPayload = {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'claude-3-haiku-20240307',
          temperature: 0.7,
          thinking: { type: 'disabled', budget_tokens: 0 },
        };

        const result = await buildDefaultAnthropicPayload(payload);

        // When thinking is disabled, it should be treated as if thinking wasn't provided
        expect(result).toEqual(
          expect.objectContaining({
            max_tokens: 4096,
            messages: [
              {
                content: [{ cache_control: { type: 'ephemeral' }, text: 'Hello', type: 'text' }],
                role: 'user',
              },
            ],
            model: 'claude-3-haiku-20240307',
            temperature: 0.35,
          }),
        );
      });
    });
  });
});
