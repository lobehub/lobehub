// @vitest-environment node
import type { GenerateContentResponse } from '@google/genai';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_ERROR_KEY } from '../../core/streams';
import { AgentRuntimeErrorType } from '../../types/error';
import * as debugStreamModule from '../../utils/debugStream';
import { LobeGoogleAI } from './index';

const provider = 'google';
const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeGoogleAI;

beforeEach(() => {
  instance = new LobeGoogleAI({ apiKey: 'test' });

  // Use vi.spyOn to mock the chat.completions.create method
  const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
  vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeGoogleAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', async () => {
      const instance = new LobeGoogleAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeGoogleAI);

      // expect(instance.baseURL).toEqual(defaultBaseURL);
    });
  });

  describe('chat', () => {
    it('should return a StreamingTextResponse on successful API call', async () => {
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
    });
    it('should handle text messages correctly', async () => {
      // Mock Google AI SDK's generateContentStream method to return a successful response stream
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Hello, world!');
          controller.close();
        },
      });
      vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
        mockStream as any,
      );

      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      expect(result).toBeInstanceOf(Response);
      // Additional assertions can be added, such as verifying the returned stream content
    });

    it('should handle grounding metadata in response', async () => {
      const data = [
        {
          text: 'Box office results',
          candidates: [
            {
              content: { parts: [{ text: 'Box office results' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
              groundingMetadata: {
                groundingChunks: [
                  { web: { uri: 'https://example.com/source', title: 'example.com' } },
                ],
                webSearchQueries: ['Nezha 2 box office'],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 10,
            totalTokenCount: 17,
          },
          modelVersion: 'gemini-2.0-flash',
        },
      ] as GenerateContentResponse[];

      const mockStream = new ReadableStream({
        start(controller) {
          for (const chunk of data) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
        mockStream as any,
      );

      const result = await instance.chat({
        messages: [{ content: 'Nezha 2 box office', role: 'user' }],
        model: 'gemini-2.0-flash',
        temperature: 0,
        enabledSearch: true,
      });

      const text = await result.text();
      // Should contain grounding event with citations
      expect(text).toContain('event: grounding');
      expect(text).toContain('example.com');
      expect(text).toContain('Nezha 2 box office');
    });

    it('should call debugStream in DEBUG mode', async () => {
      // Set environment variable to enable DEBUG mode
      process.env.DEBUG_GOOGLE_CHAT_COMPLETION = '1';

      // Mock Google AI SDK's generateContentStream method to return a successful response stream
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('Debug mode test');
          controller.close();
        },
      });
      vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
        mockStream as any,
      );
      const debugStreamSpy = vi
        .spyOn(debugStreamModule, 'debugStream')
        .mockImplementation(() => Promise.resolve());

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      expect(debugStreamSpy).toHaveBeenCalled();

      // Clean up environment variable
      delete process.env.DEBUG_GOOGLE_CHAT_COMPLETION;
    });

    describe('Error', () => {
      it('should throw InvalidGoogleAPIKey error on API_KEY_INVALID error', async () => {
        // Mock Google AI SDK throwing an exception
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}}]`;

        const apiError = new Error(message);

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({ errorType: invalidErrorType, error: { message }, provider });
        }
      });

      it('should throw LocationNotSupportError error on location not support error', async () => {
        // Mock Google AI SDK throwing an exception
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] User location is not supported for the API use.`;

        const apiError = new Error(message);

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({ errorType: 'LocationNotSupportError', error: { message }, provider });
        }
      });

      it('should throw BizError error', async () => {
        // Mock Google AI SDK throwing an exception
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"Error","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}}]`;

        const apiError = new Error(message);

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            errorType: bizErrorType,
            error: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                'domain': 'googleapis.com',
                'metadata': {
                  service: 'generativelanguage.googleapis.com',
                },
                'reason': 'Error',
              },
            ],
            provider,
          });
        }
      });

      it('should throw DefaultError error', async () => {
        // Mock Google AI SDK throwing an exception
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"Error","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com}}]`;

        const apiError = new Error(message);

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            errorType: bizErrorType,
            error: {
              message: `API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"Error","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com}}]`,
              statusCode: 400,
              statusCodeText: '[400 Bad Request]',
            },
            provider,
          });
        }
      });

      it('should return GoogleBizError with an openai error response when APIError is thrown', async () => {
        // Arrange
        const apiError = new Error('Error message');

        // Use vi.spyOn to mock the chat.completions.create method
        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            error: { message: 'Error message' },
            errorType: bizErrorType,
            provider,
          });
        }
      });

      it('should throw AgentRuntimeError with NoOpenAIAPIKey if no apiKey is provided', async () => {
        try {
          new LobeGoogleAI({});
        } catch (e) {
          expect(e).toEqual({ errorType: invalidErrorType });
        }
      });

      it('should return OpenAIBizError with the cause when OpenAI.APIError is thrown with cause', async () => {
        // Arrange
        const errorInfo = {
          stack: 'abc',
          cause: {
            message: 'api is undefined',
          },
        };
        const apiError = new OpenAI.APIError(400, errorInfo, 'module error', {});

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(apiError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            error: {
              message: `400 {"stack":"abc","cause":{"message":"api is undefined"}}`,
            },
            errorType: bizErrorType,
            provider,
          });
        }
      });

      it('should return AgentRuntimeError for non-OpenAI errors', async () => {
        // Arrange
        const genericError = new Error('Generic Error');

        vi.spyOn(instance['client'].models, 'generateContentStream').mockRejectedValue(
          genericError,
        );

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          expect(e).toEqual({
            errorType: bizErrorType,
            provider,
            error: {
              message: 'Generic Error',
            },
          });
        }
      });
    });
  });

  describe('private method', () => {
    describe('createEnhancedStream', () => {
      it('should handle stream cancellation with data gracefully', async () => {
        const mockStream = (async function* () {
          yield { text: 'Hello' };
          yield { text: ' world' };
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();
        const chunks: any[] = [];

        // Read first value then cancel to trigger error chunk
        chunks.push((await reader.read()).value); // eslint-disable-line unicorn/no-immediate-mutation
        abortController.abort();

        // Read all remaining chunks
        let result;
        while (!(result = await reader.read()).done) {
          chunks.push(result.value);
        }

        // Batch-assert the entire chunks array
        expect(chunks).toEqual([
          { text: 'Hello' },
          {
            [LOBE_ERROR_KEY]: {
              body: { name: 'Stream cancelled', provider, reason: 'aborted' },
              message: 'Stream cancelled',
              name: 'Stream cancelled',
              type: AgentRuntimeErrorType.StreamChunkError,
            },
          },
        ]);
      });

      it('should handle stream cancellation without data', async () => {
        const mockStream = (async function* () {
          // Empty stream
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();

        // Cancel immediately
        abortController.abort();

        // Should be closed without any chunks
        const chunk = await reader.read();
        expect(chunk.done).toBe(true);
      });

      it('should handle AbortError with data', async () => {
        const mockStream = (async function* () {
          yield { text: 'Hello' };
          throw new Error('aborted');
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();
        const chunks: any[] = [];

        // Read first value then collect remaining chunks (error included)
        chunks.push((await reader.read()).value); // eslint-disable-line unicorn/no-immediate-mutation
        let result;
        while (!(result = await reader.read()).done) {
          chunks.push(result.value);
        }

        // Assert both data and error chunk together
        expect(chunks).toEqual([
          { text: 'Hello' },
          {
            [LOBE_ERROR_KEY]: {
              body: { name: 'Stream cancelled', provider, reason: 'aborted' },
              message: 'Stream cancelled',
              name: 'Stream cancelled',
              type: AgentRuntimeErrorType.StreamChunkError,
            },
          },
        ]);
      });

      it('should handle AbortError without data', async () => {
        // eslint-disable-next-line require-yield
        const mockStream = (async function* () {
          throw new Error('aborted');
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();
        const chunks: any[] = [];

        // Read error chunk
        const chunk1 = await reader.read();
        chunks.push(chunk1.value);

        // Stream should be closed
        const chunk2 = await reader.read();
        expect(chunk2.done).toBe(true);

        expect(chunks[0][LOBE_ERROR_KEY]).toEqual({
          body: {
            message: 'aborted',
            name: 'AbortError',
            provider,
            stack: expect.any(String),
          },
          message: 'aborted',
          name: 'AbortError',
          type: AgentRuntimeErrorType.StreamChunkError,
        });
      });

      it('should handle other stream parsing errors', async () => {
        const mockStream = (async function* () {
          yield { text: 'Hello' };
          throw new Error('Network error');
        })();

        const abortController = new AbortController();
        const enhancedStream = instance['createEnhancedStream'](mockStream, abortController.signal);

        const reader = enhancedStream.getReader();
        const chunks: any[] = [];

        // Read first value then collect remaining chunks (parsing error)
        chunks.push((await reader.read()).value); // eslint-disable-line unicorn/no-immediate-mutation
        let result;
        while (!(result = await reader.read()).done) {
          chunks.push(result.value);
        }

        expect(chunks).toEqual([
          { text: 'Hello' },
          {
            [LOBE_ERROR_KEY]: {
              body: { message: 'Network error', provider },
              message: 'Network error',
              name: 'Stream parsing error',
              type: AgentRuntimeErrorType.ProviderBizError,
            },
          },
        ]);
      });
    });
  });
});

describe('thinkingConfig includeThoughts logic', () => {
  it('should enable thinking when thinkingBudget is set', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-2.5-pro',
      thinkingBudget: 5000,
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBe(true);
  });

  it('should enable thinking when thinkingLevel is set', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3-pro',
      thinkingLevel: 'high',
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBe(true);
  });

  it('should let API decide thinking for gemini-3-pro-image models without explicit params', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3-pro-image-preview',
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    // Gemini 3 models without explicit thinkingLevel/thinkingBudget → let API decide
    expect(config.thinkingConfig?.includeThoughts).toBeUndefined();
  });

  it('should enable thinking for thinking-enabled models', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-2.0-flash-thinking-exp',
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBe(true);
  });

  it('should disable thinking when resolvedThinkingBudget is 0', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-2.5-flash-lite',
      thinkingBudget: 0,
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config;
    expect(config.thinkingConfig?.includeThoughts).toBeUndefined();
  });

  it('should add thinkingLevel to config for 3.x models when provided', async () => {
    const mockStreamData = (async function* (): AsyncGenerator<GenerateContentResponse> {})();
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(mockStreamData);

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3-pro',
      thinkingLevel: 'high',
      temperature: 0,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config as any;
    expect(config.thinkingConfig?.thinkingLevel).toBe('high');
  });
});

describe('buildGoogleToolsWithSearch', () => {
  it('should include imageSearch searchTypes for models in modelsWithImageSearch when search is enabled', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          text: 'test',
          candidates: [
            {
              content: { parts: [{ text: 'test' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 },
          modelVersion: 'gemini-3.1-flash-image-preview',
        });
        controller.close();
      },
    });
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
      mockStream as any,
    );

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3.1-flash-image-preview',
      temperature: 0,
      enabledSearch: true,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config as any;
    expect(config.tools).toEqual([
      { googleSearch: { searchTypes: { imageSearch: {}, webSearch: {} } } },
    ]);
  });

  it('should use plain googleSearch for non-imageSearch models when search is enabled', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          text: 'test',
          candidates: [
            {
              content: { parts: [{ text: 'test' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 },
          modelVersion: 'gemini-2.0-flash',
        });
        controller.close();
      },
    });
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
      mockStream as any,
    );

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-2.0-flash',
      temperature: 0,
      enabledSearch: true,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config as any;
    expect(config.tools).toEqual([{ googleSearch: {} }]);
  });

  it('should combine search tools with function declarations for Gemini 3+ models', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          text: 'test',
          candidates: [
            {
              content: { parts: [{ text: 'test' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 },
          modelVersion: 'gemini-3.1-pro-preview',
        });
        controller.close();
      },
    });
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
      mockStream as any,
    );

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3.1-pro-preview',
      temperature: 0,
      enabledSearch: true,
      urlContext: true,
      tools: [{ type: 'function', function: { name: 'test_tool', description: 'A test tool' } }],
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config as any;
    expect(config.tools).toEqual([
      { urlContext: {} },
      { googleSearch: {} },
      {
        functionDeclarations: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parametersJsonSchema: {
              properties: { dummy: { type: 'string' } },
              type: 'object',
            },
          },
        ],
      },
    ]);
    // https://ai.google.dev/gemini-api/docs/tool-combination
    expect(config.toolConfig).toEqual({ includeServerSideToolInvocations: true });
  });

  it('should not set includeServerSideToolInvocations for Vertex AI', async () => {
    const vertexInstance = new LobeGoogleAI({ apiKey: 'test', isVertexAi: true });
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          text: 'test',
          candidates: [
            {
              content: { parts: [{ text: 'test' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 },
          modelVersion: 'gemini-3.1-pro-preview',
        });
        controller.close();
      },
    });
    vi.spyOn(vertexInstance['client'].models, 'generateContentStream').mockResolvedValue(
      mockStream as any,
    );

    await vertexInstance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3.1-pro-preview',
      temperature: 0,
      enabledSearch: true,
      tools: [{ type: 'function', function: { name: 'test_tool', description: 'A test tool' } }],
    });

    const callArgs = (vertexInstance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config as any;
    // Vertex AI does not support includeServerSideToolInvocations
    expect(config.toolConfig).toBeUndefined();
  });

  it('should not set toolConfig when Gemini 3+ has only search tools without function declarations', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          text: 'test',
          candidates: [
            {
              content: { parts: [{ text: 'test' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 },
          modelVersion: 'gemini-3.1-pro-preview',
        });
        controller.close();
      },
    });
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
      mockStream as any,
    );

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-3.1-pro-preview',
      temperature: 0,
      enabledSearch: true,
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config as any;
    expect(config.tools).toEqual([{ googleSearch: {} }]);
    expect(config.toolConfig).toBeUndefined();
  });

  it('should exclude function declarations when search is enabled for pre-Gemini 3 models', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          text: 'test',
          candidates: [
            {
              content: { parts: [{ text: 'test' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 },
          modelVersion: 'gemini-2.5-pro',
        });
        controller.close();
      },
    });
    vi.spyOn(instance['client'].models, 'generateContentStream').mockResolvedValue(
      mockStream as any,
    );

    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gemini-2.5-pro',
      temperature: 0,
      enabledSearch: true,
      urlContext: true,
      tools: [{ type: 'function', function: { name: 'test_tool', description: 'A test tool' } }],
    });

    const callArgs = (instance['client'].models.generateContentStream as any).mock.calls[0];
    const config = callArgs[0].config as any;
    // Pre-Gemini 3 models should only have search tools, no functionDeclarations
    expect(config.tools).toEqual([{ urlContext: {} }, { googleSearch: {} }]);
  });
});

describe('models', () => {
  it('should pass API Key via x-goog-api-key header instead of URL parameter', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ models: [] }),
      ok: true,
    });
    global.fetch = mockFetch;

    const apiKey = 'test-google-key';
    const localInstance = new LobeGoogleAI({ apiKey });

    await localInstance.models();
    const [url, options] = mockFetch.mock.calls[0];

    expect(url).not.toContain('key=');
    expect(options.headers).toMatchObject({
      'x-goog-api-key': apiKey,
    });
  });
});
