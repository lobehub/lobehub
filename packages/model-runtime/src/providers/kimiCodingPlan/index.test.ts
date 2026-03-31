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
