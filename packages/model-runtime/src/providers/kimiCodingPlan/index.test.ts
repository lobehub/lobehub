// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as debugStreamModule from '../../utils/debugStream';
import { LobeKimiCodingPlanAI, params } from './index';

const provider = ModelProvider.KimiCodingPlan;
const defaultBaseURL = 'https://api.kimi.com/coding';

const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: InstanceType<typeof LobeKimiCodingPlanAI>;

beforeEach(() => {
  instance = new LobeKimiCodingPlanAI({ apiKey: 'test' });

  // Use vi.spyOn to mock the Anthropic messages.create call.
  vi.spyOn(instance['client'].messages, 'create').mockResolvedValue(new ReadableStream() as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeKimiCodingPlanAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', async () => {
      const instance = new LobeKimiCodingPlanAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeKimiCodingPlanAI);
      expect(instance.baseURL).toBe(defaultBaseURL);
    });

    it('should correctly initialize with a baseURL', async () => {
      const instance = new LobeKimiCodingPlanAI({
        apiKey: 'test_api_key',
        baseURL: 'https://api.custom.com/coding',
      });
      expect(instance).toBeInstanceOf(LobeKimiCodingPlanAI);
      expect(instance.baseURL).toBe('https://api.custom.com/coding');
    });

    it('should correctly initialize with different id', async () => {
      const instance = new LobeKimiCodingPlanAI({
        apiKey: 'test_api_key',
        id: 'abc',
      });
      expect(instance).toBeInstanceOf(LobeKimiCodingPlanAI);
      expect(instance['id']).toBe('abc');
    });
  });

  describe('params', () => {
    it('should have correct baseURL', () => {
      expect(params.baseURL).toBe(defaultBaseURL);
    });

    it('should have correct provider', () => {
      expect(params.provider).toBe(provider);
    });
  });

  describe('chat', () => {
    it('should return a StreamingTextResponse on successful API call', async () => {
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'k2p5',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
    });

    describe('max_tokens handling', () => {
      const getLastRequestPayload = () => {
        const calls = (instance['client'].messages.create as Mock).mock.calls;
        return calls.at(-1)?.[0];
      };

      it('should use hardcoded maxOutput for k2p5 (deploymentName)', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'k2p5',
        });

        const payload = getLastRequestPayload();
        expect(payload.max_tokens).toBe(32_768);
      });

      it('should use hardcoded maxOutput for kimi-k2.5 (model id)', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
        });

        const payload = getLastRequestPayload();
        expect(payload.max_tokens).toBe(32_768);
      });

      it('should use hardcoded maxOutput for kimi-k2-thinking', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2-thinking',
        });

        const payload = getLastRequestPayload();
        expect(payload.max_tokens).toBe(65_536);
      });

      it('should use default 8192 for unknown models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'unknown-model',
        });

        const payload = getLastRequestPayload();
        expect(payload.max_tokens).toBe(8192);
      });

      it('should respect user-provided max_tokens', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          max_tokens: 4096,
        });

        const payload = getLastRequestPayload();
        expect(payload.max_tokens).toBe(4096);
      });
    });

    describe('thinking parameter handling', () => {
      const getLastRequestPayload = () => {
        const calls = (instance['client'].messages.create as Mock).mock.calls;
        return calls.at(-1)?.[0];
      };

      it('should enable thinking by default for kimi-k2.5', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
        });

        const payload = getLastRequestPayload();
        expect(payload.thinking).toEqual({ budget_tokens: 1024, type: 'enabled' });
        expect(payload.temperature).toBe(1);
        expect(payload.top_p).toBe(0.95);
      });

      it('should disable thinking when type is disabled for kimi-k2.5', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          thinking: { budget_tokens: 0, type: 'disabled' },
        });

        const payload = getLastRequestPayload();
        expect(payload.thinking).toEqual({ type: 'disabled' });
        expect(payload.temperature).toBe(0.6);
      });

      it('should always enable thinking for kimi-k2-thinking', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2-thinking',
        });

        const payload = getLastRequestPayload();
        expect(payload.thinking).toEqual({ budget_tokens: 1024, type: 'enabled' });
        expect(payload.temperature).toBe(1);
        expect(payload.top_p).toBe(0.95);
      });

      it('should ignore thinking disabled for native thinking models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2-thinking',
          thinking: { budget_tokens: 0, type: 'disabled' },
        });

        const payload = getLastRequestPayload();
        expect(payload.thinking).toEqual({ budget_tokens: 1024, type: 'enabled' });
      });

      it('should respect custom thinking budget', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          max_tokens: 4096,
          thinking: { budget_tokens: 2048, type: 'enabled' },
        });

        const payload = getLastRequestPayload();
        expect(payload.thinking).toEqual({ budget_tokens: 2048, type: 'enabled' });
      });

      it('should cap thinking budget to max_tokens - 1', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.5',
          thinking: { budget_tokens: 100_000, type: 'enabled' },
        });

        const payload = getLastRequestPayload();
        // max_tokens defaults to 32_768 for kimi-k2.5, so budget capped to 32_767
        expect(payload.thinking!.budget_tokens).toBe(32_767);
      });

      it('should not add thinking params for unknown models', async () => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'unknown-model',
        });

        const payload = getLastRequestPayload();
        expect(payload.thinking).toBeUndefined();
      });
    });

    describe('message normalization for thinking', () => {
      const getLastRequestPayload = () => {
        const calls = (instance['client'].messages.create as Mock).mock.calls;
        return calls.at(-1)?.[0];
      };

      it('should force thinking block on assistant messages for kimi-k2-thinking', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: 'Response', role: 'assistant' },
            { content: 'Follow-up', role: 'user' },
          ],
          model: 'kimi-k2-thinking',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toEqual([
          { type: 'thinking', thinking: ' ' },
          { type: 'text', text: 'Response' },
        ]);
      });

      it('should force thinking block on assistant messages for kimi-k2.5 with thinking enabled', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: 'Response', role: 'assistant' },
            { content: 'Follow-up', role: 'user' },
          ],
          model: 'kimi-k2.5',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toEqual([
          { type: 'thinking', thinking: ' ' },
          { type: 'text', text: 'Response' },
        ]);
      });

      it('should not force thinking block when thinking is disabled', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: 'Response', role: 'assistant' },
          ],
          model: 'kimi-k2.5',
          thinking: { budget_tokens: 0, type: 'disabled' },
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        // Content is converted to array by Anthropic factory, but no thinking block
        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Response' })]),
        );
        expect(assistantMessage?.content).not.toContainEqual(
          expect.objectContaining({ type: 'thinking' }),
        );
      });

      it('should convert reasoning to thinking block for assistant messages', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            {
              content: 'Response',
              role: 'assistant',
              reasoning: { content: 'My reasoning process' },
            } as any,
          ],
          model: 'kimi-k2.5',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'thinking', thinking: 'My reasoning process' }),
            expect.objectContaining({ type: 'text', text: 'Response' }),
          ]),
        );
      });

      it('should handle empty content with reasoning', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            {
              content: '',
              role: 'assistant',
              reasoning: { content: 'My reasoning process' },
            } as any,
          ],
          model: 'kimi-k2.5',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'thinking', thinking: 'My reasoning process' }),
            expect.objectContaining({ type: 'text', text: ' ' }),
          ]),
        );
      });

      it('should add placeholder thinking when reasoning has signature', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            {
              content: 'Response',
              role: 'assistant',
              reasoning: { content: 'My reasoning', signature: 'some-signature' },
            } as any,
          ],
          model: 'kimi-k2.5',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        // reasoning with signature is invalid, so placeholder thinking is added
        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'thinking', thinking: ' ' }),
            expect.objectContaining({ type: 'text', text: 'Response' }),
          ]),
        );
      });

      it('should handle assistant message with tool_calls and reasoning', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            {
              content: '',
              role: 'assistant',
              reasoning: { content: 'Thinking about tools' },
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"Beijing"}' },
                },
              ],
            } as any,
            {
              content: '{"temp": 20}',
              role: 'tool',
              tool_call_id: 'call_1',
            } as any,
          ],
          model: 'kimi-k2.5',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'thinking', thinking: 'Thinking about tools' }),
            expect.objectContaining({ type: 'tool_use', name: 'get_weather' }),
          ]),
        );
      });

      it('should add placeholder thinking for tool_calls without reasoning', async () => {
        // This is the bug scenario: tool_calls without reasoning_content
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            {
              content: '',
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"Beijing"}' },
                },
              ],
            } as any,
            {
              content: '{"temp": 20}',
              role: 'tool',
              tool_call_id: 'call_1',
            } as any,
          ],
          model: 'kimi-k2.5',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        // Should have placeholder thinking block to avoid API error
        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'thinking', thinking: ' ' }),
            expect.objectContaining({ type: 'tool_use', name: 'get_weather' }),
          ]),
        );
      });

      it('should handle empty assistant message with placeholder', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: '', role: 'assistant' },
            { content: 'Follow-up', role: 'user' },
          ],
          model: 'kimi-k2-thinking',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(assistantMessage?.content).toEqual([
          { type: 'thinking', thinking: ' ' },
          { type: 'text', text: ' ' },
        ]);
      });

      it('should not modify non-thinking model messages', async () => {
        await instance.chat({
          messages: [
            { content: 'Hello', role: 'user' },
            { content: 'Response', role: 'assistant' },
          ],
          model: 'unknown-model',
        });

        const payload = getLastRequestPayload();
        const assistantMessage = payload.messages.find(
          (message: any) => message.role === 'assistant',
        );

        // Content is converted to array by Anthropic factory, but no thinking block
        expect(assistantMessage?.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Response' })]),
        );
        expect(assistantMessage?.content).not.toContainEqual(
          expect.objectContaining({ type: 'thinking' }),
        );
      });
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
        model: 'k2p5',
        temperature: 0,
        top_p: 1,
      });

      // Assert
      expect(instance['client'].messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'k2p5',
          stream: true,
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

      const originalDebugValue = process.env.DEBUG_KIMI_CODING_PLAN_CHAT_COMPLETION;

      process.env.DEBUG_KIMI_CODING_PLAN_CHAT_COMPLETION = '1';
      vi.spyOn(debugStreamModule, 'debugStream').mockImplementation(() => Promise.resolve());

      // Act
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'k2p5',
        temperature: 0,
      });

      // Assert
      expect(debugStreamModule.debugStream).toHaveBeenCalled();

      // Cleanup
      process.env.DEBUG_KIMI_CODING_PLAN_CHAT_COMPLETION = originalDebugValue;
    });

    describe('Error', () => {
      it('should throw InvalidProviderAPIKey error on 401 error', async () => {
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
            model: 'k2p5',
            temperature: 0,
          });
        } catch (e) {
          // Assert - endpoint is desensitized for non-default URLs
          expect(e).toEqual({
            endpoint: 'https://api.***.com/coding',
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
              message: 'API is temporarily overloaded',
            },
          },
        };
        (instance['client'].messages.create as Mock).mockRejectedValue(apiError);

        try {
          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'k2p5',
            temperature: 0,
          });
        } catch (e) {
          // Assert - endpoint is desensitized for non-default URLs
          expect(e).toEqual({
            endpoint: 'https://api.***.com/coding',
            error: apiError.error.error,
            errorType: bizErrorType,
            message: 'API is temporarily overloaded',
            provider,
          });
        }
      });

      it('should throw InvalidProviderAPIKey if no apiKey is provided', async () => {
        try {
          new LobeKimiCodingPlanAI({});
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

        // Act & Assert - endpoint is desensitized for non-default URLs
        await expect(
          instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'k2p5',
            temperature: 1,
          }),
        ).rejects.toEqual({
          endpoint: 'https://api.***.com/coding',
          error: apiError,
          errorType: 'LocationNotSupportError',
          provider,
        });
      });

      it('should throw ProviderBizError on other error status codes', async () => {
        // Arrange
        const apiError = { status: 500 };
        (instance['client'].messages.create as Mock).mockRejectedValue(apiError);

        // Act & Assert - endpoint is desensitized for non-default URLs
        await expect(
          instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'k2p5',
            temperature: 1,
          }),
        ).rejects.toEqual({
          endpoint: 'https://api.***.com/coding',
          error: {
            headers: undefined,
            stack: undefined,
            status: 500,
          },
          errorType: bizErrorType,
          provider,
        });
      });

      it('should desensitize custom baseURL in error message', async () => {
        // Arrange
        const apiError = { status: 401 };
        const customInstance = new LobeKimiCodingPlanAI({
          apiKey: 'test',
          baseURL: 'https://api.custom.com/coding',
        });
        vi.spyOn(customInstance['client'].messages, 'create').mockRejectedValue(apiError);

        // Act & Assert
        await expect(
          customInstance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'k2p5',
            temperature: 0,
          }),
        ).rejects.toEqual({
          endpoint: 'https://api.cu****om.com/coding',
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
            model: 'k2p5',
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
            model: 'k2p5',
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
            model: 'k2p5',
            temperature: 1,
          },
          { headers },
        );

        // Assert
        expect(result.headers.get('X-Test-Header')).toBe('test');
      });
    });
  });
});
