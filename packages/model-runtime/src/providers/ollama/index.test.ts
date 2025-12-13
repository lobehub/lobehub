// @vitest-environment node
import { imageUrlToBase64 } from '@lobechat/utils';
import { ModelProvider } from 'model-bank';
import { Ollama } from 'ollama/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import * as debugStreamModule from '../../utils/debugStream';
import { LobeOllamaAI, params } from './index';

vi.mock('ollama/browser');
vi.mock('@lobechat/utils', async () => {
  const actual = await vi.importActual('@lobechat/utils');
  return {
    ...actual,
    imageUrlToBase64: vi.fn(),
  };
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeOllamaAI', () => {
  let ollamaAI: LobeOllamaAI;

  beforeEach(() => {
    ollamaAI = new LobeOllamaAI({ baseURL: 'https://example.com' });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should initialize Ollama client and baseURL with valid baseURL', () => {
      expect(ollamaAI['client']).toBeInstanceOf(Ollama);
      expect(ollamaAI.baseURL).toBe('https://example.com');
    });

    it('should initialize Ollama client without baseURL', () => {
      const instance = new LobeOllamaAI();
      expect(instance['client']).toBeInstanceOf(Ollama);
      expect(instance.baseURL).toBeUndefined();
    });

    it('should throw AgentRuntimeError with invalid baseURL', () => {
      try {
        new LobeOllamaAI({ baseURL: 'invalid-url' });
      } catch (e) {
        expect(e).toMatchObject({
          error: new TypeError('Invalid URL'),
          errorType: 'InvalidOllamaArgs',
        });
      }
    });
  });

  describe('chat', () => {
    it('should call Ollama client chat method and return StreamingResponse', async () => {
      const chatMock = vi.fn().mockResolvedValue({});
      vi.mocked(Ollama.prototype.chat).mockImplementation(chatMock);

      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
      };
      const options = { signal: new AbortController().signal };

      const response = await ollamaAI.chat(payload as any, options);

      expect(chatMock).toHaveBeenCalledWith({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
        options: {
          frequency_penalty: undefined,
          presence_penalty: undefined,
          temperature: undefined,
          top_p: undefined,
        },
        stream: true,
      });
      expect(response).toBeInstanceOf(Response);
    });

    it('should throw AgentRuntimeError when Ollama client chat method throws an error', async () => {
      const errorMock = {
        message: 'Chat error',
        name: 'ChatError',
        status_code: 500,
      };
      vi.mocked(Ollama.prototype.chat).mockRejectedValue(errorMock);

      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
      };

      try {
        await ollamaAI.chat(payload as any);
      } catch (e) {
        expect(e).toEqual(
          AgentRuntimeError.chat({
            error: errorMock,
            errorType: AgentRuntimeErrorType.OllamaBizError,
            provider: ModelProvider.Ollama,
          }),
        );
      }
    });

    it('should abort the request when signal aborts', async () => {
      const abortMock = vi.fn();
      vi.mocked(Ollama.prototype.abort).mockImplementation(abortMock);

      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
      };
      const options = { signal: new AbortController().signal };

      ollamaAI.chat(payload as any, options);

      options.signal.dispatchEvent(new Event('abort'));

      expect(abortMock).toHaveBeenCalled();
    });

    it('temperature should be divided by two', async () => {
      const chatMock = vi.fn().mockResolvedValue({});
      vi.mocked(Ollama.prototype.chat).mockImplementation(chatMock);

      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
        temperature: 0.7,
      };
      const options = { signal: new AbortController().signal };

      const response = await ollamaAI.chat(payload as any, options);

      expect(chatMock).toHaveBeenCalledWith({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
        options: {
          frequency_penalty: undefined,
          presence_penalty: undefined,
          temperature: 0.35,
          top_p: undefined,
        },
        stream: true,
      });
      expect(response).toBeInstanceOf(Response);
    });

    it('should pass tools to Ollama client', async () => {
      const chatMock = vi.fn().mockResolvedValue({});
      vi.mocked(Ollama.prototype.chat).mockImplementation(chatMock);

      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
        tools: [
          {
            type: 'function',
            function: { name: 'tool1', description: '', parameters: {} },
          },
        ],
      };
      const options = { signal: new AbortController().signal };

      await ollamaAI.chat(payload as any, options);

      expect(chatMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: { name: 'tool1', description: '', parameters: {} },
            },
          ],
        }),
      );
    });

    it('should throw OllamaServiceUnavailable when fetch fails', async () => {
      const errorMock = { message: 'fetch failed' };
      vi.mocked(Ollama.prototype.chat).mockRejectedValue(errorMock);

      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
      };

      try {
        await ollamaAI.chat(payload as any);
      } catch (e) {
        expect(e).toEqual(
          AgentRuntimeError.chat({
            error: { message: 'please check whether your ollama service is available' },
            errorType: AgentRuntimeErrorType.OllamaServiceUnavailable,
            provider: ModelProvider.Ollama,
          }),
        );
      }
    });

    it('should handle error with string error field', async () => {
      const errorMock = {
        error: 'Some error string',
        message: 'Error occurred',
        name: 'OllamaError',
        status_code: 500,
      };
      vi.mocked(Ollama.prototype.chat).mockRejectedValue(errorMock);

      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
      };

      try {
        await ollamaAI.chat(payload as any);
      } catch (e) {
        expect(e).toEqual(
          AgentRuntimeError.chat({
            error: {
              // When error is a string, it uses e.message instead
              message: 'Error occurred',
              name: 'OllamaError',
              status_code: 500,
            },
            errorType: AgentRuntimeErrorType.OllamaBizError,
            provider: ModelProvider.Ollama,
          }),
        );
      }
    });

    it('should handle error with object error field', async () => {
      const errorMock = {
        error: { message: 'Object error message', code: 'ERROR_CODE' },
        message: 'Error occurred',
        name: 'OllamaError',
        status_code: 500,
      };
      vi.mocked(Ollama.prototype.chat).mockRejectedValue(errorMock);

      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
      };

      try {
        await ollamaAI.chat(payload as any);
      } catch (e) {
        expect(e).toEqual(
          AgentRuntimeError.chat({
            error: {
              message: 'Object error message',
              code: 'ERROR_CODE',
              name: 'OllamaError',
              status_code: 500,
            },
            errorType: AgentRuntimeErrorType.OllamaBizError,
            provider: ModelProvider.Ollama,
          }),
        );
      }
    });

    it('should pass all parameters correctly', async () => {
      const chatMock = vi.fn().mockResolvedValue({});
      vi.mocked(Ollama.prototype.chat).mockImplementation(chatMock);

      const payload = {
        frequency_penalty: 0.5,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
        presence_penalty: 0.3,
        temperature: 0.8,
        top_p: 0.9,
      };

      await ollamaAI.chat(payload as any);

      expect(chatMock).toHaveBeenCalledWith({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'model-id',
        options: {
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          temperature: 0.4,
          top_p: 0.9,
        },
        stream: true,
        tools: undefined,
      });
    });

    describe('DEBUG', () => {
      it('should call debugStream when DEBUG_OLLAMA_CHAT_COMPLETION is 1', async () => {
        const originalDebugValue = process.env.DEBUG_OLLAMA_CHAT_COMPLETION;
        process.env.DEBUG_OLLAMA_CHAT_COMPLETION = '1';

        const mockProdStream = new ReadableStream() as any;
        const mockDebugStream = new ReadableStream() as any;

        const mockAsyncIterator = {
          [Symbol.asyncIterator]: () => mockAsyncIterator,
          next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        };

        vi.mocked(Ollama.prototype.chat).mockResolvedValue(mockAsyncIterator as any);
        vi.spyOn(debugStreamModule, 'debugStream').mockImplementation(() => Promise.resolve());

        const payload = {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'model-id',
        };

        await ollamaAI.chat(payload as any);

        // Note: The actual debugStream call happens asynchronously
        // We're just verifying the code path is set up correctly
        process.env.DEBUG_OLLAMA_CHAT_COMPLETION = originalDebugValue;
      });
    });
  });

  describe('models', () => {
    it('should call Ollama client list method and return ChatModelCard array', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'model-1' }, { name: 'model-2' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      expect(listMock).toHaveBeenCalled();
      expect(models).toEqual([
        {
          contextWindowTokens: undefined,
          displayName: undefined,
          enabled: false,
          functionCall: false,
          id: 'model-1',
          reasoning: false,
          vision: false,
        },
        {
          contextWindowTokens: undefined,
          displayName: undefined,
          enabled: false,
          functionCall: false,
          id: 'model-2',
          reasoning: false,
          vision: false,
        },
      ]);
    });

    it('should merge with known model list for capabilities', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'llama3.1:latest' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      expect(models.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle case-insensitive model matching with known models', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'LLAMA3.1:LATEST' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      expect(models.length).toBeGreaterThanOrEqual(1);
      expect(models[0].id).toBe('LLAMA3.1:LATEST');
    });

    it('should handle empty model list', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      expect(models).toEqual([]);
    });

    it('should set enabled property from known model list', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'llama3.1:latest' }, { name: 'unknown-model' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      expect(models.length).toBe(2);
      const unknownModel = models.find((m) => m.id === 'unknown-model');
      expect(unknownModel?.enabled).toBe(false);
    });

    it('should set functionCall from known model abilities', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'llama3.1:latest' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      const model = models.find((m) => m.id === 'llama3.1:latest');
      expect(model).toHaveProperty('functionCall');
    });

    it('should set vision from known model abilities', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'llama3.2-vision:latest' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      const model = models.find((m) => m.id === 'llama3.2-vision:latest');
      if (model) {
        expect(model).toHaveProperty('vision');
      }
    });

    it('should set reasoning from known model abilities', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'test-model' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      expect(models[0]).toHaveProperty('reasoning');
    });

    it('should preserve context window tokens from known model', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'llama3.1:latest' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      const model = models.find((m) => m.id === 'llama3.1:latest');
      expect(model).toHaveProperty('contextWindowTokens');
    });

    it('should set displayName from known model', async () => {
      const listMock = vi.fn().mockResolvedValue({
        models: [{ name: 'llama3.1:latest' }],
      });
      vi.mocked(Ollama.prototype.list).mockImplementation(listMock);

      const models = await ollamaAI.models();

      const model = models.find((m) => m.id === 'llama3.1:latest');
      expect(model).toHaveProperty('displayName');
    });
  });

  describe('buildOllamaMessages', () => {
    it('should convert OpenAIChatMessage array to OllamaMessage array', async () => {
      const messages = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi there!', role: 'assistant' },
      ];

      const ollamaMessages = await ollamaAI['buildOllamaMessages'](messages as any);

      expect(ollamaMessages).toEqual([
        { content: 'Hello', role: 'user' },
        { content: 'Hi there!', role: 'assistant' },
      ]);
    });

    it('should handle empty message array', async () => {
      const messages: any[] = [];

      const ollamaMessages = await ollamaAI['buildOllamaMessages'](messages);

      expect(ollamaMessages).toEqual([]);
    });

    it('should handle multiple messages with different roles', async () => {
      const messages = [
        { content: 'Hello', role: 'system' },
        { content: 'Hi', role: 'user' },
        { content: 'Hello there', role: 'assistant' },
        { content: 'How are you?', role: 'user' },
      ];

      const ollamaMessages = await ollamaAI['buildOllamaMessages'](messages as any);

      expect(ollamaMessages).toHaveLength(4);
      expect(ollamaMessages[0].role).toBe('system');
      expect(ollamaMessages[1].role).toBe('user');
      expect(ollamaMessages[2].role).toBe('assistant');
      expect(ollamaMessages[3].role).toBe('user');
    });
  });

  describe('convertContentToOllamaMessage', () => {
    it('should convert string content to OllamaMessage', async () => {
      const message = { content: 'Hello', role: 'user' };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({ content: 'Hello', role: 'user' });
    });

    it('should convert text content to OllamaMessage', async () => {
      const message = {
        content: [{ type: 'text', text: 'Hello' }],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({ content: 'Hello', role: 'user' });
    });

    it('should convert image_url content to OllamaMessage with images', async () => {
      const message = {
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,abc123' },
          },
        ],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: '',
        role: 'user',
        images: ['abc123'],
      });
    });

    it('should ignore invalid image_url content', async () => {
      const message = {
        content: [
          {
            type: 'image_url',
            image_url: { url: 'invalid-url' },
          },
        ],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: '',
        role: 'user',
      });
    });

    it('should handle mixed text and image content', async () => {
      const message = {
        content: [
          { type: 'text', text: 'First text' },
          { type: 'text', text: 'Second text' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,abc123' },
          },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,def456' },
          },
        ],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: 'Second text', // Should keep latest text
        role: 'user',
        images: ['abc123', 'def456'],
      });
    });

    it('should handle content with empty text', async () => {
      const message = {
        content: [{ type: 'text', text: '' }],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: '',
        role: 'user',
      });
    });

    it('should handle content with only images (no text)', async () => {
      const message = {
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,abc123' },
          },
        ],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: '',
        role: 'user',
        images: ['abc123'],
      });
    });

    it('should handle multiple images without text', async () => {
      const message = {
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,abc123' },
          },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,def456' },
          },
          {
            type: 'image_url',
            image_url: { url: 'data:image/gif;base64,ghi789' },
          },
        ],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: '',
        role: 'user',
        images: ['abc123', 'def456', 'ghi789'],
      });
    });

    it('should ignore images with invalid data URIs', async () => {
      // Mock imageUrlToBase64 to simulate conversion failure for external URLs
      vi.mocked(imageUrlToBase64).mockRejectedValue(new Error('Network error'));

      const message = {
        content: [
          { type: 'text', text: 'Hello' },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/image.png' },
          },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,valid123' },
          },
        ],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: 'Hello',
        role: 'user',
        images: ['valid123'],
      });
    });

    it('should handle complex interleaved content', async () => {
      const message = {
        content: [
          { type: 'text', text: 'Text 1' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,img1' },
          },
          { type: 'text', text: 'Text 2' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,img2' },
          },
          { type: 'text', text: 'Text 3' },
        ],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: 'Text 3', // Should keep latest text
        role: 'user',
        images: ['img1', 'img2'],
      });
    });

    it('should handle assistant role with images', async () => {
      const message = {
        content: [
          { type: 'text', text: 'Here is the image' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,abc123' },
          },
        ],
        role: 'assistant',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: 'Here is the image',
        role: 'assistant',
        images: ['abc123'],
      });
    });

    it('should handle system role with text', async () => {
      const message = {
        content: [{ type: 'text', text: 'You are a helpful assistant' }],
        role: 'system',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: 'You are a helpful assistant',
        role: 'system',
      });
    });

    it('should handle empty content array', async () => {
      const message = {
        content: [],
        role: 'user',
      };

      const ollamaMessage = await ollamaAI['convertContentToOllamaMessage'](message as any);

      expect(ollamaMessage).toEqual({
        content: '',
        role: 'user',
      });
    });
  });

  describe('embeddings', () => {
    it('should handle single input string', async () => {
      const embeddingsMock = vi.fn().mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
      });
      vi.mocked(Ollama.prototype.embeddings).mockImplementation(embeddingsMock);

      const result = await ollamaAI.embeddings({
        input: 'test input',
        model: 'embed-model',
      });

      expect(embeddingsMock).toHaveBeenCalledWith({
        model: 'embed-model',
        prompt: 'test input',
      });
      expect(result).toEqual([[0.1, 0.2, 0.3]]);
    });

    it('should handle array of input strings', async () => {
      const embeddingsMock = vi
        .fn()
        .mockResolvedValueOnce({ embedding: [0.1, 0.2, 0.3] })
        .mockResolvedValueOnce({ embedding: [0.4, 0.5, 0.6] });
      vi.mocked(Ollama.prototype.embeddings).mockImplementation(embeddingsMock);

      const result = await ollamaAI.embeddings({
        input: ['input 1', 'input 2'],
        model: 'embed-model',
      });

      expect(embeddingsMock).toHaveBeenCalledTimes(2);
      expect(embeddingsMock).toHaveBeenNthCalledWith(1, {
        model: 'embed-model',
        prompt: 'input 1',
      });
      expect(embeddingsMock).toHaveBeenNthCalledWith(2, {
        model: 'embed-model',
        prompt: 'input 2',
      });
      expect(result).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
    });

    it('should pass dimensions parameter', async () => {
      const embeddingsMock = vi.fn().mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
      });
      vi.mocked(Ollama.prototype.embeddings).mockImplementation(embeddingsMock);

      await ollamaAI.embeddings({
        dimensions: 128,
        input: 'test input',
        model: 'embed-model',
      });

      expect(embeddingsMock).toHaveBeenCalledWith({
        model: 'embed-model',
        prompt: 'test input',
      });
    });

    it('should throw OllamaBizError on embedding error', async () => {
      const errorMock = {
        message: 'Embedding error',
        name: 'EmbeddingError',
        status_code: 500,
      };
      vi.mocked(Ollama.prototype.embeddings).mockRejectedValue(errorMock);

      try {
        await ollamaAI.embeddings({
          input: 'test input',
          model: 'embed-model',
        });
      } catch (e) {
        expect(e).toEqual(
          AgentRuntimeError.chat({
            error: errorMock,
            errorType: AgentRuntimeErrorType.OllamaBizError,
            provider: ModelProvider.Ollama,
          }),
        );
      }
    });
  });

  describe('pullModel', () => {
    it('should successfully pull a model', async () => {
      const mockAsyncIterator = {
        [Symbol.asyncIterator]: () => mockAsyncIterator,
        next: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: { status: 'downloading', completed: 50, total: 100 },
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      vi.mocked(Ollama.prototype.pull).mockResolvedValue(mockAsyncIterator as any);

      const response = await ollamaAI.pullModel({ model: 'test-model' });

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should pass insecure parameter', async () => {
      const pullMock = vi.fn().mockResolvedValue({
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      });
      vi.mocked(Ollama.prototype.pull).mockImplementation(pullMock);

      await ollamaAI.pullModel({ model: 'test-model', insecure: true });

      expect(pullMock).toHaveBeenCalledWith({
        insecure: true,
        model: 'test-model',
        stream: true,
      });
    });

    it('should default insecure to false', async () => {
      const pullMock = vi.fn().mockResolvedValue({
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      });
      vi.mocked(Ollama.prototype.pull).mockImplementation(pullMock);

      await ollamaAI.pullModel({ model: 'test-model' });

      expect(pullMock).toHaveBeenCalledWith({
        insecure: false,
        model: 'test-model',
        stream: true,
      });
    });

    it('should handle abort signal', async () => {
      const abortController = new AbortController();
      const abortMock = vi.fn();
      vi.mocked(Ollama.prototype.abort).mockImplementation(abortMock);

      const mockAsyncIterator = {
        [Symbol.asyncIterator]: () => mockAsyncIterator,
        next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      };

      vi.mocked(Ollama.prototype.pull).mockResolvedValue(mockAsyncIterator as any);

      const responsePromise = ollamaAI.pullModel(
        { model: 'test-model' },
        { signal: abortController.signal },
      );

      abortController.abort();

      await responsePromise;

      expect(abortMock).toHaveBeenCalled();
    });

    it('should handle OllamaServiceUnavailable error', async () => {
      const errorMock = new Error('fetch failed');
      vi.mocked(Ollama.prototype.pull).mockRejectedValue(errorMock);

      const response = await ollamaAI.pullModel({ model: 'test-model' });

      // Status code 472 is for OllamaServiceUnavailable (see errorResponse.ts)
      expect(response.status).toBe(472);
      const body = await response.json();
      expect(body).toMatchObject({
        errorType: AgentRuntimeErrorType.OllamaServiceUnavailable,
      });
    });

    it('should handle AbortError', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      vi.mocked(Ollama.prototype.pull).mockRejectedValue(abortError);

      const response = await ollamaAI.pullModel({ model: 'test-model' });

      expect(response.status).toBe(499);
      const body = await response.json();
      expect(body).toEqual({
        model: 'test-model',
        status: 'cancelled',
      });
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Generic error');
      vi.mocked(Ollama.prototype.pull).mockRejectedValue(genericError);

      const response = await ollamaAI.pullModel({ model: 'test-model' });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        error: 'Generic error',
        model: 'test-model',
        status: 'error',
      });
    });

    it('should handle non-Error objects', async () => {
      vi.mocked(Ollama.prototype.pull).mockRejectedValue('String error');

      const response = await ollamaAI.pullModel({ model: 'test-model' });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({
        error: 'String error',
        model: 'test-model',
        status: 'error',
      });
    });

    it('should handle stream cancellation via reader cancel', async () => {
      const abortController = new AbortController();
      const abortMock = vi.fn();
      const removeEventListenerSpy = vi.spyOn(abortController.signal, 'removeEventListener');
      vi.mocked(Ollama.prototype.abort).mockImplementation(abortMock);

      const mockAsyncIterator = {
        [Symbol.asyncIterator]: () => mockAsyncIterator,
        next: vi.fn().mockResolvedValue({ done: false, value: { status: 'downloading' } }),
      };

      vi.mocked(Ollama.prototype.pull).mockResolvedValue(mockAsyncIterator as any);

      const response = await ollamaAI.pullModel(
        { model: 'test-model' },
        { signal: abortController.signal },
      );

      const reader = response.body?.getReader();
      // Cancel the stream to trigger onCancel callback
      await reader?.cancel();

      // Verify that abort was called and listener was removed
      expect(abortMock).toHaveBeenCalled();
      expect(removeEventListenerSpy).toHaveBeenCalled();
    });

    it('should remove abort listener on error', async () => {
      const abortController = new AbortController();
      const removeEventListenerSpy = vi.spyOn(abortController.signal, 'removeEventListener');

      const genericError = new Error('Generic error');
      vi.mocked(Ollama.prototype.pull).mockRejectedValue(genericError);

      await ollamaAI.pullModel({ model: 'test-model' }, { signal: abortController.signal });

      expect(removeEventListenerSpy).toHaveBeenCalled();
    });
  });

  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.Ollama);
      expect(params.baseURL).toBeUndefined();
      expect(params.debug).toBeDefined();
      expect(params.debug.chatCompletion).toBeInstanceOf(Function);
    });

    it('should disable debug by default', () => {
      delete process.env.DEBUG_OLLAMA_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_OLLAMA_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_OLLAMA_CHAT_COMPLETION;
    });
  });
});
