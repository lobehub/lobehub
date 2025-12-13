// @vitest-environment node
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatCompletionTool } from '../../types/chat';
import * as debugStreamModule from '../../utils/debugStream';
import { LobeCloudflareAI } from './index';

const provider = 'cloudflare';

const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeCloudflareAI;
const textEncoder = new TextEncoder();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LobeCloudflareAI', () => {
  const accountID = '80009000a000b000c000d000e000f000';
  describe('init', () => {
    it('should correctly initialize with API key and Account ID', async () => {
      const instance = new LobeCloudflareAI({
        apiKey: 'test_api_key',
        baseURLOrAccountID: accountID,
      });
      expect(instance).toBeInstanceOf(LobeCloudflareAI);
      expect(instance.baseURL).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${accountID}/ai/run/`,
      );
      expect(instance.accountID).toBe(accountID);
    });

    it('should correctly initialize with API key and Gateway URL', async () => {
      const baseURL = `https://gateway.ai.cloudflare.com/v1/${accountID}/test-gateway/workers-ai`;
      const instance = new LobeCloudflareAI({
        apiKey: 'test_api_key',
        baseURLOrAccountID: baseURL,
      });
      expect(instance).toBeInstanceOf(LobeCloudflareAI);
      expect(instance.baseURL).toBe(baseURL + '/'); // baseURL MUST end with '/'.
      expect(instance.accountID).toBe(accountID);
    });
  });

  describe('chat', () => {
    beforeEach(() => {
      instance = new LobeCloudflareAI({
        apiKey: 'test_api_key',
        baseURLOrAccountID: accountID,
      });

      // Mock fetch
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(textEncoder.encode('data: {"response": "Hello, world!"}\n\n'));
              controller.close();
            },
          }),
        ),
      );
    });

    it('should return a Response on successful API call', async () => {
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '@hf/meta-llama/meta-llama-3-8b-instruct',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
    });

    it('should handle text messages correctly', async () => {
      // Arrange
      const textEncoder = new TextEncoder();
      const mockResponse = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(textEncoder.encode('data: {"response": "Hello, world!"}\n\n'));
            controller.close();
          },
        }),
      );
      (globalThis.fetch as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '@hf/meta-llama/meta-llama-3-8b-instruct',
        temperature: 0,
        top_p: 1,
      });

      // Assert
      expect(globalThis.fetch).toHaveBeenCalledWith(
        // url
        expect.objectContaining({
          pathname: `/client/v4/accounts/${accountID}/ai/run/@hf/meta-llama/meta-llama-3-8b-instruct`,
        }),
        // body
        expect.objectContaining({
          body: expect.any(String),
          method: 'POST',
        }),
      );

      const fetchCallArgs = (globalThis.fetch as Mock).mock.calls[0];
      const body = JSON.parse(fetchCallArgs[1].body);
      expect(body).toEqual(
        expect.objectContaining({
          //max_tokens: 4096,
          messages: [{ content: 'Hello', role: 'user' }],
          //stream: true,
          temperature: 0,
          top_p: 1,
        }),
      );

      expect(result).toBeInstanceOf(Response);
    });

    it('should handle system prompt correctly', async () => {
      // Arrange
      const textEncoder = new TextEncoder();
      const mockResponse = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(textEncoder.encode('data: {"response": "Hello, world!"}\n\n'));
            controller.close();
          },
        }),
      );
      (globalThis.fetch as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        messages: [
          { content: 'You are an awesome greeter', role: 'system' },
          { content: 'Hello', role: 'user' },
        ],
        model: '@hf/meta-llama/meta-llama-3-8b-instruct',
        temperature: 0,
      });

      // Assert
      expect(globalThis.fetch).toHaveBeenCalledWith(
        // url
        expect.objectContaining({
          pathname: `/client/v4/accounts/${accountID}/ai/run/@hf/meta-llama/meta-llama-3-8b-instruct`,
        }),
        // body
        expect.objectContaining({
          body: expect.any(String),
          method: 'POST',
        }),
      );

      const fetchCallArgs = (globalThis.fetch as Mock).mock.calls[0];
      const body = JSON.parse(fetchCallArgs[1].body);
      expect(body).toEqual(
        expect.objectContaining({
          //max_tokens: 4096,
          messages: [
            { content: 'You are an awesome greeter', role: 'system' },
            { content: 'Hello', role: 'user' },
          ],
          //stream: true,
          temperature: 0,
        }),
      );

      expect(result).toBeInstanceOf(Response);
    });

    it('should call Cloudflare API with supported opions', async () => {
      // Arrange
      const mockResponse = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(textEncoder.encode('data: {"response": "Hello, world!"}\n\n'));
            controller.close();
          },
        }),
      );
      (globalThis.fetch as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        max_tokens: 2048,
        messages: [{ content: 'Hello', role: 'user' }],
        model: '@hf/meta-llama/meta-llama-3-8b-instruct',
        temperature: 0.5,
        top_p: 1,
      });

      // Assert
      expect(globalThis.fetch).toHaveBeenCalledWith(
        // url
        expect.objectContaining({
          pathname: `/client/v4/accounts/${accountID}/ai/run/@hf/meta-llama/meta-llama-3-8b-instruct`,
        }),
        // body
        expect.objectContaining({
          body: expect.any(String),
          method: 'POST',
        }),
      );

      const fetchCallArgs = (globalThis.fetch as Mock).mock.calls[0];
      const body = JSON.parse(fetchCallArgs[1].body);
      expect(body).toEqual(
        expect.objectContaining({
          max_tokens: 2048,
          messages: [{ content: 'Hello', role: 'user' }],
          //stream: true,
          temperature: 0.5,
          top_p: 1,
        }),
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

      (globalThis.fetch as Mock).mockResolvedValue({
        body: {
          tee: () => [mockProdStream, { toReadableStream: () => mockDebugStream }],
        },
      });

      const originalDebugValue = process.env.DEBUG_CLOUDFLARE_CHAT_COMPLETION;

      process.env.DEBUG_CLOUDFLARE_CHAT_COMPLETION = '1';
      vi.spyOn(debugStreamModule, 'debugStream').mockImplementation(() => Promise.resolve());

      // Act
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '@hf/meta-llama/meta-llama-3-8b-instruct',
        temperature: 0,
      });

      // Assert
      expect(debugStreamModule.debugStream).toHaveBeenCalled();

      // Cleanup
      process.env.DEBUG_CLOUDFLARE_CHAT_COMPLETION = originalDebugValue;
    });

    describe('chat with tools', () => {
      it('should call client.beta.tools.messages.create when tools are provided', async () => {
        // Arrange
        const tools: ChatCompletionTool[] = [
          { function: { name: 'tool1', description: 'desc1' }, type: 'function' },
        ];

        // Act
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: '@hf/meta-llama/meta-llama-3-8b-instruct',
          temperature: 1,
          tools,
        });

        // Assert
        expect(globalThis.fetch).toHaveBeenCalled();

        const fetchCallArgs = (globalThis.fetch as Mock).mock.calls[0];
        const body = JSON.parse(fetchCallArgs[1].body);
        expect(body).toEqual(
          expect.objectContaining({
            tools: tools.map((t) => t.function),
          }),
        );
      });
    });

    describe('Error', () => {
      it('should throw ProviderBizError error on 400 error', async () => {
        // Arrange
        const apiError = {
          status: 400,
          error: {
            type: 'error',
            error: {
              type: 'authentication_error',
              message: 'invalid x-api-key',
            },
          },
        };
        (globalThis.fetch as Mock).mockRejectedValue(apiError);

        try {
          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: '@hf/meta-llama/meta-llama-3-8b-instruct',
            temperature: 0,
          });
        } catch (e) {
          // Assert
          expect(e).toEqual({
            endpoint: expect.stringMatching(/https:\/\/.+/),
            error: apiError,
            errorType: bizErrorType,
            provider,
          });
        }
      });

      it('should throw InvalidProviderAPIKey if no accountID is provided', async () => {
        try {
          new LobeCloudflareAI({
            apiKey: 'test',
          });
        } catch (e) {
          expect(e).toEqual({ errorType: invalidErrorType });
        }
      });

      it('should throw InvalidProviderAPIKey if no apiKey is provided', async () => {
        try {
          new LobeCloudflareAI({
            baseURLOrAccountID: accountID,
          });
        } catch (e) {
          expect(e).toEqual({ errorType: invalidErrorType });
        }
      });

      it('should not throw Error when apiKey is not provided but baseURL is provided', async () => {
        const customInstance = new LobeCloudflareAI({
          baseURLOrAccountID: 'https://custom.cloudflare.url/',
        });
        expect(customInstance).toBeInstanceOf(LobeCloudflareAI);
        expect(customInstance.apiKey).toBeUndefined();
        expect(customInstance.baseURL).toBe('https://custom.cloudflare.url/');
      });
    });

    describe('Error handling', () => {
      it('should throw ProviderBizError on other error status codes', async () => {
        // Arrange
        const apiError = { status: 400 };
        (globalThis.fetch as Mock).mockRejectedValue(apiError);

        // Act & Assert
        await expect(
          instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: '@hf/meta-llama/meta-llama-3-8b-instruct',
            temperature: 1,
          }),
        ).rejects.toEqual({
          endpoint: expect.stringMatching(/https:\/\/.+/),
          error: apiError,
          errorType: bizErrorType,
          provider,
        });
      });

      it('should desensitize accountID in error message', async () => {
        // Arrange
        const apiError = { status: 400 };
        const customInstance = new LobeCloudflareAI({
          apiKey: 'test',
          baseURLOrAccountID: accountID,
        });
        (globalThis.fetch as Mock).mockRejectedValue(apiError);

        // Act & Assert
        await expect(
          customInstance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: '@hf/meta-llama/meta-llama-3-8b-instruct',
            temperature: 0,
          }),
        ).rejects.toEqual({
          endpoint: expect.not.stringContaining(accountID),
          error: apiError,
          errorType: bizErrorType,
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
            model: '@hf/meta-llama/meta-llama-3-8b-instruct',
            temperature: 1,
          },
          { signal: controller.signal },
        );

        // Assert
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.any(URL),
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
            model: '@hf/meta-llama/meta-llama-3-8b-instruct',
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
            model: '@hf/meta-llama/meta-llama-3-8b-instruct',
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
            model: '@hf/meta-llama/meta-llama-3-8b-instruct',
            temperature: 1,
          }),
        ).resolves.toBeInstanceOf(Response);
      });
    });
  });

  describe('models', () => {
    it('should send request', async () => {
      // Arrange
      const apiKey = 'test_api_key';
      const instance = new LobeCloudflareAI({ apiKey, baseURLOrAccountID: accountID });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            result: [
              {
                description: 'Model 1',
                name: 'model1',
                task: { name: 'Text Generation' },
                properties: [{ property_id: 'beta', value: 'false' }],
              },
              {
                description: 'Model 2',
                name: 'model2',
                task: { name: 'Text Generation' },
                properties: [{ property_id: 'beta', value: 'true' }],
              },
            ],
          }),
        ),
      );

      // Act
      const result = await instance.models();

      // Assert
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://api.cloudflare.com/client/v4/accounts/${accountID}/ai/models/search`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'GET',
        },
      );

      expect(result).toHaveLength(2);
    });
  });
});
