// @vitest-environment node
import {
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../types/error';
import * as debugStreamModule from '../../utils/debugStream';
import { experimental_buildLlama2Prompt, LobeBedrockAI } from './index';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

vi.mock('@aws-sdk/client-bedrock-runtime', async (importOriginal) => {
  const module = await importOriginal();
  return {
    ...(module as any),
    InvokeModelCommand: vi.fn(),
    InvokeModelWithResponseStreamCommand: vi.fn(),
  };
});

let instance: LobeBedrockAI;

beforeEach(() => {
  instance = new LobeBedrockAI({
    region: 'us-west-2',
    accessKeyId: 'test-access-key-id',
    accessKeySecret: 'test-access-key-secret',
  });

  vi.spyOn(instance['client'], 'send').mockReturnValue(new ReadableStream() as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeBedrockAI', () => {
  describe('init', () => {
    it('should correctly initialize with AWS credentials', async () => {
      const instance = new LobeBedrockAI({
        region: 'us-west-2',
        accessKeyId: 'test-access-key-id',
        accessKeySecret: 'test-access-key-secret',
      });
      expect(instance).toBeInstanceOf(LobeBedrockAI);
      expect(instance.region).toBe('us-west-2');
    });

    it('should use default region if not provided', () => {
      const instance = new LobeBedrockAI({
        accessKeyId: 'test-access-key-id',
        accessKeySecret: 'test-access-key-secret',
      });
      expect(instance.region).toBe('us-east-1');
    });

    it('should correctly initialize with session token', () => {
      const instance = new LobeBedrockAI({
        region: 'us-west-2',
        accessKeyId: 'test-access-key-id',
        accessKeySecret: 'test-access-key-secret',
        sessionToken: 'test-session-token',
      });
      expect(instance).toBeInstanceOf(LobeBedrockAI);
    });

    it('should throw InvalidBedrockCredentials if accessKeyId is missing', () => {
      expect(() => {
        new LobeBedrockAI({
          accessKeySecret: 'test-access-key-secret',
        });
      }).toThrow(
        expect.objectContaining({
          errorType: AgentRuntimeErrorType.InvalidBedrockCredentials,
        }),
      );
    });

    it('should throw InvalidBedrockCredentials if accessKeySecret is missing', () => {
      expect(() => {
        new LobeBedrockAI({
          accessKeyId: 'test-access-key-id',
        });
      }).toThrow(
        expect.objectContaining({
          errorType: AgentRuntimeErrorType.InvalidBedrockCredentials,
        }),
      );
    });

    it('should throw InvalidBedrockCredentials if both credentials are missing', () => {
      expect(() => {
        new LobeBedrockAI({});
      }).toThrow(
        expect.objectContaining({
          errorType: AgentRuntimeErrorType.InvalidBedrockCredentials,
        }),
      );
    });
  });

  describe('chat', () => {
    it('should call invokeLlamaModel when model starts with "meta"', async () => {
      // @ts-ignore
      const spy = vi.spyOn(instance, 'invokeLlamaModel');

      // Act
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'meta.llama:1',
        temperature: 0,
      });

      // Assert
      expect(spy).toHaveBeenCalled();
    });

    it('should call invokeClaudeModel when model does not start with "meta"', async () => {
      // @ts-ignore
      const spy = vi.spyOn(instance, 'invokeClaudeModel');

      // Act
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'anthropic.claude-v2:1',
        temperature: 0,
      });

      // Assert
      expect(spy).toHaveBeenCalled();
    });

    describe('Claude model', () => {
      it('should return a Response on successful API call', async () => {
        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'anthropic.claude-v2:1',
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
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        // Act
        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'anthropic.claude-v2:1',
          temperature: 0,
          top_p: 1,
        });

        // Assert
        expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 4096,
            messages: [
              {
                content: [
                  {
                    cache_control: { type: 'ephemeral' },
                    text: 'Hello',
                    type: 'text',
                  },
                ],
                role: 'user',
              },
            ],
            temperature: 0,
            top_p: 1,
          }),
          contentType: 'application/json',
          modelId: 'anthropic.claude-v2:1',
        });
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
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        // Act
        const result = await instance.chat({
          messages: [
            { content: 'You are an awesome greeter', role: 'system' },
            { content: 'Hello', role: 'user' },
          ],
          model: 'anthropic.claude-v2:1',
          temperature: 0,
          top_p: 1,
        });

        // Assert
        expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 4096,
            messages: [
              {
                content: [
                  {
                    cache_control: { type: 'ephemeral' },
                    text: 'Hello',
                    type: 'text',
                  },
                ],
                role: 'user',
              },
            ],
            system: [
              {
                cache_control: { type: 'ephemeral' },
                text: 'You are an awesome greeter',
                type: 'text',
              },
            ],
            temperature: 0,
            top_p: 1,
          }),
          contentType: 'application/json',
          modelId: 'anthropic.claude-v2:1',
        });
        expect(result).toBeInstanceOf(Response);
      });

      it('should call Anthropic model with supported opions', async () => {
        // Arrange
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue('Hello, world!');
            controller.close();
          },
        });
        const mockResponse = Promise.resolve(mockStream);
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        // Act
        const result = await instance.chat({
          max_tokens: 2048,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'anthropic.claude-v2:1',
          temperature: 0.5,
          top_p: 1,
        });

        // Assert
        expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2048,
            messages: [
              {
                content: [
                  {
                    cache_control: { type: 'ephemeral' },
                    text: 'Hello',
                    type: 'text',
                  },
                ],
                role: 'user',
              },
            ],
            temperature: 0.25,
            top_p: 1,
          }),
          contentType: 'application/json',
          modelId: 'anthropic.claude-v2:1',
        });
        expect(result).toBeInstanceOf(Response);
      });

      it('should handle tools parameter', async () => {
        // Arrange
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue('Hello, world!');
            controller.close();
          },
        });
        const mockResponse = Promise.resolve(mockStream);
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        const tools = [
          {
            function: {
              description: 'Get weather information',
              name: 'get_weather',
              parameters: {
                properties: {
                  location: {
                    description: 'City name',
                    type: 'string',
                  },
                },
                required: ['location'],
                type: 'object',
              },
            },
            type: 'function' as const,
          },
        ];

        // Act
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'anthropic.claude-v2:1',
          temperature: 0.5,
          tools,
        });

        // Assert
        const callArgs = (InvokeModelWithResponseStreamCommand as any as Mock).mock.calls[0][0];
        const bodyContent = JSON.parse(callArgs.body);
        expect(bodyContent.tools).toBeDefined();
      });

      it('should use default max_tokens when not provided', async () => {
        // Arrange
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue('Hello, world!');
            controller.close();
          },
        });
        const mockResponse = Promise.resolve(mockStream);
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        // Act
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'anthropic.claude-v2:1',
          temperature: 0,
        });

        // Assert
        expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 4096,
            messages: [
              {
                content: [
                  {
                    cache_control: { type: 'ephemeral' },
                    text: 'Hello',
                    type: 'text',
                  },
                ],
                role: 'user',
              },
            ],
            temperature: 0,
          }),
          contentType: 'application/json',
          modelId: 'anthropic.claude-v2:1',
        });
      });

      it('should call Anthropic model without unsupported opions', async () => {
        // Arrange
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue('Hello, world!');
            controller.close();
          },
        });
        const mockResponse = Promise.resolve(mockStream);
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        // Act
        const result = await instance.chat({
          frequency_penalty: 0.5, // Unsupported option
          max_tokens: 2048,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'anthropic.claude-v2:1',
          presence_penalty: 0.5,
          temperature: 0.5,
          top_p: 1,
        });

        // Assert
        expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2048,
            messages: [
              {
                content: [
                  {
                    cache_control: { type: 'ephemeral' },
                    text: 'Hello',
                    type: 'text',
                  },
                ],
                role: 'user',
              },
            ],
            temperature: 0.25,
            top_p: 1,
          }),
          contentType: 'application/json',
          modelId: 'anthropic.claude-v2:1',
        });
        expect(result).toBeInstanceOf(Response);
      });

      it('should call debugStream when DEBUG_BEDROCK_CHAT_COMPLETION is set to "1"', async () => {
        // Arrange
        process.env.DEBUG_BEDROCK_CHAT_COMPLETION = '1';
        const spy = vi.spyOn(debugStreamModule, 'debugStream');

        // Act
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'anthropic.claude-v2:1',
          temperature: 0,
        });

        // Assert
        expect(spy).toHaveBeenCalled();

        // Clean up
        delete process.env.DEBUG_BEDROCK_CHAT_COMPLETION;
      });

      describe('Parameter conflict handling for Claude 4+ models', () => {
        it('should send only temperature for Claude 4+ models when both temperature and top_p are provided', async () => {
          // Arrange
          const mockStream = new ReadableStream({
            start(controller) {
              controller.enqueue('Hello, world!');
              controller.close();
            },
          });
          const mockResponse = Promise.resolve(mockStream);
          (instance['client'].send as Mock).mockResolvedValue(mockResponse);

          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'anthropic.claude-opus-4-1-20250805-v1:0',
            temperature: 0.8,
            top_p: 0.9,
          });

          // Assert
          expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 8192,
              messages: [
                {
                  content: [
                    {
                      cache_control: { type: 'ephemeral' },
                      text: 'Hello',
                      type: 'text',
                    },
                  ],
                  role: 'user',
                },
              ],
              temperature: 0.4, // temperature / 2, top_p omitted due to conflict
            }),
            contentType: 'application/json',
            modelId: 'anthropic.claude-opus-4-1-20250805-v1:0',
          });
        });

        it('should send only top_p for Claude 4+ models when temperature is not provided', async () => {
          // Arrange
          const mockStream = new ReadableStream({
            start(controller) {
              controller.enqueue('Hello, world!');
              controller.close();
            },
          });
          const mockResponse = Promise.resolve(mockStream);
          (instance['client'].send as Mock).mockResolvedValue(mockResponse);

          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'anthropic.claude-sonnet-4-20250514-v1:0',
            top_p: 0.9,
          });

          // Assert
          expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 8192,
              messages: [
                {
                  content: [
                    {
                      cache_control: { type: 'ephemeral' },
                      text: 'Hello',
                      type: 'text',
                    },
                  ],
                  role: 'user',
                },
              ],
              top_p: 0.9, // temperature omitted since not provided
            }),
            contentType: 'application/json',
            modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
          });
        });

        it('should send both temperature and top_p for non-Claude-4+ models', async () => {
          // Arrange
          const mockStream = new ReadableStream({
            start(controller) {
              controller.enqueue('Hello, world!');
              controller.close();
            },
          });
          const mockResponse = Promise.resolve(mockStream);
          (instance['client'].send as Mock).mockResolvedValue(mockResponse);

          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            temperature: 0.8,
            top_p: 0.9,
          });

          // Assert
          expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 8192,
              messages: [
                {
                  content: [
                    {
                      cache_control: { type: 'ephemeral' },
                      text: 'Hello',
                      type: 'text',
                    },
                  ],
                  role: 'user',
                },
              ],
              temperature: 0.4, // temperature / 2
              top_p: 0.9, // both parameters allowed for older models
            }),
            contentType: 'application/json',
            modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          });
        });

        it('should handle US region Claude 4+ model IDs correctly', async () => {
          // Arrange
          const mockStream = new ReadableStream({
            start(controller) {
              controller.enqueue('Hello, world!');
              controller.close();
            },
          });
          const mockResponse = Promise.resolve(mockStream);
          (instance['client'].send as Mock).mockResolvedValue(mockResponse);

          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
            temperature: 0.6,
            top_p: 0.8,
          });

          // Assert
          expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 64_000,
              messages: [
                {
                  content: [
                    {
                      cache_control: { type: 'ephemeral' },
                      text: 'Hello',
                      type: 'text',
                    },
                  ],
                  role: 'user',
                },
              ],
              temperature: 0.3, // temperature / 2, top_p omitted due to conflict
            }),
            contentType: 'application/json',
            modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          });
        });

        it('should handle standard Claude 4+ model IDs (non-Bedrock format)', async () => {
          // Arrange
          const mockStream = new ReadableStream({
            start(controller) {
              controller.enqueue('Hello, world!');
              controller.close();
            },
          });
          const mockResponse = Promise.resolve(mockStream);
          (instance['client'].send as Mock).mockResolvedValue(mockResponse);

          // Act
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'claude-opus-4-1',
            temperature: 0.7,
            top_p: 0.95,
          });

          // Assert
          expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 8192,
              messages: [
                {
                  content: [
                    {
                      cache_control: { type: 'ephemeral' },
                      text: 'Hello',
                      type: 'text',
                    },
                  ],
                  role: 'user',
                },
              ],
              temperature: 0.35, // temperature / 2, top_p omitted due to conflict
            }),
            contentType: 'application/json',
            modelId: 'claude-opus-4-1',
          });
        });
      });

      it('should handle errors and throw AgentRuntimeError', async () => {
        // Arrange
        const errorMessage = 'An error occurred';
        const errorMetadata = { statusCode: 500 };
        const mockError = new Error(errorMessage);
        (mockError as any).$metadata = errorMetadata;
        (instance['client'].send as Mock).mockRejectedValue(mockError);

        // Act & Assert
        await expect(
          instance.chat({
            max_tokens: 100,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'anthropic.claude-v2:1',
            temperature: 0,
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            error: {
              body: errorMetadata,
              message: errorMessage,
              type: 'Error',
            },
            errorType: AgentRuntimeErrorType.ProviderBizError,
            provider: ModelProvider.Bedrock,
            region: 'us-west-2',
          }),
        );
      });
    });

    describe('Llama Model', () => {
      it('should return a Response on successful API call', async () => {
        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'meta.llama:1',
          temperature: 0,
        });

        // Assert
        expect(result).toBeInstanceOf(Response);
      });

      it('should call Llama model with valid payload', async () => {
        // Arrange
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue('Hello, world!');
            controller.close();
          },
        });
        const mockResponse = Promise.resolve(mockStream);
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        // Act
        const result = await instance.chat({
          temperature: 0,
          max_tokens: 100,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'meta.llama:1',
        });

        // Assert
        expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
          accept: 'application/json',
          body: JSON.stringify({
            max_gen_len: 100,
            prompt: '<s>[INST] Hello [/INST]',
          }),
          contentType: 'application/json',
          modelId: 'meta.llama:1',
        });
        expect(result).toBeInstanceOf(Response);
      });

      it('should handle errors and throw AgentRuntimeError', async () => {
        // Arrange
        const errorMessage = 'An error occurred';
        const errorMetadata = { statusCode: 500 };
        const mockError = new Error(errorMessage);
        (mockError as any).$metadata = errorMetadata;
        (instance['client'].send as Mock).mockRejectedValue(mockError);

        // Act & Assert
        await expect(
          instance.chat({
            max_tokens: 100,
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'meta.llama:1',
            temperature: 0,
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            error: {
              body: errorMetadata,
              message: errorMessage,
              region: 'us-west-2',
              type: 'Error',
            },
            errorType: AgentRuntimeErrorType.ProviderBizError,
            provider: ModelProvider.Bedrock,
            region: 'us-west-2',
          }),
        );
      });

      it('should call debugStream when DEBUG_BEDROCK_CHAT_COMPLETION is set to "1"', async () => {
        // Arrange
        process.env.DEBUG_BEDROCK_CHAT_COMPLETION = '1';
        const spy = vi.spyOn(debugStreamModule, 'debugStream');

        // Act
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'meta.llama:1',
          temperature: 0,
        });

        // Assert
        expect(spy).toHaveBeenCalled();

        // Clean up
        delete process.env.DEBUG_BEDROCK_CHAT_COMPLETION;
      });

      it('should use default max_tokens (400) when not provided', async () => {
        // Arrange
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue('Hello, world!');
            controller.close();
          },
        });
        const mockResponse = Promise.resolve(mockStream);
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        // Act
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'meta.llama:1',
          temperature: 0,
        });

        // Assert
        expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
          accept: 'application/json',
          body: JSON.stringify({
            max_gen_len: 400,
            prompt: '<s>[INST] Hello [/INST]',
          }),
          contentType: 'application/json',
          modelId: 'meta.llama:1',
        });
      });

      it('should handle system message in Llama prompt', async () => {
        // Arrange
        const mockStream = new ReadableStream({
          start(controller) {
            controller.enqueue('Hello, world!');
            controller.close();
          },
        });
        const mockResponse = Promise.resolve(mockStream);
        (instance['client'].send as Mock).mockResolvedValue(mockResponse);

        // Act
        await instance.chat({
          messages: [
            { content: 'You are a helpful assistant', role: 'system' },
            { content: 'Hello', role: 'user' },
          ],
          model: 'meta.llama2-70b-chat-v1',
          temperature: 0,
        });

        // Assert
        expect(InvokeModelWithResponseStreamCommand).toHaveBeenCalledWith({
          accept: 'application/json',
          body: JSON.stringify({
            max_gen_len: 400,
            prompt: '<s>[INST] <<SYS>>\nYou are a helpful assistant\n<</SYS>>\n\nHello [/INST]',
          }),
          contentType: 'application/json',
          modelId: 'meta.llama2-70b-chat-v1',
        });
      });
    });

    it('should call options.callback when provided', async () => {
      // Arrange
      const onStart = vi.fn();

      // Act
      await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'anthropic.claude-v2:1',
          temperature: 0,
        },
        { callback: { onStart } },
      );

      // Assert
      expect(onStart).toHaveBeenCalled();
    });
  });

  describe('embeddings', () => {
    it('should handle single input string', async () => {
      // Arrange
      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding })),
      };
      (instance['client'].send as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.embeddings({
        input: 'test input',
        model: 'amazon.titan-embed-text-v1',
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockEmbedding);
      expect(InvokeModelCommand).toHaveBeenCalledWith({
        accept: 'application/json',
        body: JSON.stringify({
          inputText: 'test input',
          normalize: true,
        }),
        contentType: 'application/json',
        modelId: 'amazon.titan-embed-text-v1',
      });
    });

    it('should handle multiple input strings', async () => {
      // Arrange
      const mockEmbedding1 = [0.1, 0.2, 0.3];
      const mockEmbedding2 = [0.4, 0.5, 0.6];
      const mockResponse1 = {
        body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding1 })),
      };
      const mockResponse2 = {
        body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding2 })),
      };
      (instance['client'].send as Mock)
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      // Act
      const result = await instance.embeddings({
        input: ['test input 1', 'test input 2'],
        model: 'amazon.titan-embed-text-v1',
      });

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockEmbedding1);
      expect(result[1]).toEqual(mockEmbedding2);
      expect(InvokeModelCommand).toHaveBeenCalledTimes(2);
    });

    it('should handle dimensions parameter', async () => {
      // Arrange
      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding })),
      };
      (instance['client'].send as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.embeddings({
        dimensions: 512,
        input: 'test input',
        model: 'amazon.titan-embed-text-v1',
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(InvokeModelCommand).toHaveBeenCalledWith({
        accept: 'application/json',
        body: JSON.stringify({
          dimensions: 512,
          inputText: 'test input',
          normalize: true,
        }),
        contentType: 'application/json',
        modelId: 'amazon.titan-embed-text-v1',
      });
    });

    it('should handle abort signal', async () => {
      // Arrange
      const mockEmbedding = [0.1, 0.2, 0.3];
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({ embedding: mockEmbedding })),
      };
      const sendSpy = vi.spyOn(instance['client'], 'send').mockResolvedValue(mockResponse as any);
      const abortController = new AbortController();

      // Act
      await instance.embeddings(
        {
          input: 'test input',
          model: 'amazon.titan-embed-text-v1',
        },
        { signal: abortController.signal },
      );

      // Assert
      expect(sendSpy).toHaveBeenCalledWith(expect.any(InvokeModelCommand), {
        abortSignal: abortController.signal,
      });
    });

    it('should throw AgentRuntimeError on API error', async () => {
      // Arrange
      const errorMessage = 'Embedding API error';
      const errorMetadata = { statusCode: 400 };
      const mockError = new Error(errorMessage);
      (mockError as any).$metadata = errorMetadata;
      (instance['client'].send as Mock).mockRejectedValue(mockError);

      // Act & Assert
      await expect(
        instance.embeddings({
          input: 'test input',
          model: 'amazon.titan-embed-text-v1',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          error: {
            body: errorMetadata,
            message: errorMessage,
            type: 'Error',
          },
          errorType: AgentRuntimeErrorType.ProviderBizError,
          provider: ModelProvider.Bedrock,
          region: 'us-west-2',
        }),
      );
    });
  });

  describe('experimental_buildLlama2Prompt', () => {
    it('should build prompt with user message only', () => {
      const messages = [{ content: 'Hello', role: 'user' }];
      const result = experimental_buildLlama2Prompt(messages);
      expect(result).toBe('<s>[INST] Hello [/INST]');
    });

    it('should build prompt with system and user messages', () => {
      const messages = [
        { content: 'You are a helpful assistant', role: 'system' },
        { content: 'Hello', role: 'user' },
      ];
      const result = experimental_buildLlama2Prompt(messages);
      expect(result).toBe(
        '<s>[INST] <<SYS>>\nYou are a helpful assistant\n<</SYS>>\n\nHello [/INST]',
      );
    });

    it('should build prompt with conversation history', () => {
      const messages = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi there!', role: 'assistant' },
        { content: 'How are you?', role: 'user' },
      ];
      const result = experimental_buildLlama2Prompt(messages);
      expect(result).toBe('<s>[INST] Hello [/INST] Hi there!</s><s>[INST] How are you? [/INST]');
    });

    it('should build prompt with system, user, and assistant messages', () => {
      const messages = [
        { content: 'You are a helpful assistant', role: 'system' },
        { content: 'Hello', role: 'user' },
        { content: 'Hi there!', role: 'assistant' },
        { content: 'How are you?', role: 'user' },
      ];
      const result = experimental_buildLlama2Prompt(messages);
      expect(result).toBe(
        '<s>[INST] <<SYS>>\nYou are a helpful assistant\n<</SYS>>\n\nHello [/INST] Hi there!</s><s>[INST] How are you? [/INST]',
      );
    });

    it('should trim user messages', () => {
      const messages = [{ content: '  Hello  ', role: 'user' }];
      const result = experimental_buildLlama2Prompt(messages);
      expect(result).toBe('<s>[INST] Hello [/INST]');
    });

    it('should throw error for function messages', () => {
      const messages = [{ content: 'function call', role: 'function' }];
      expect(() => experimental_buildLlama2Prompt(messages)).toThrow(
        'Llama 2 does not support function calls.',
      );
    });

    it('should throw error for invalid role', () => {
      const messages = [{ content: 'invalid', role: 'invalid' }];
      expect(() => experimental_buildLlama2Prompt(messages)).toThrow(
        'Invalid message role: invalid',
      );
    });

    it('should throw error for system message not at index 0', () => {
      const messages = [
        { content: 'Hello', role: 'user' },
        { content: 'You are a helpful assistant', role: 'system' },
      ];
      expect(() => experimental_buildLlama2Prompt(messages)).toThrow(
        'Invalid message role: system',
      );
    });
  });
});
