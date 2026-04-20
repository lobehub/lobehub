// @vitest-environment node
import type { ClientSecretPayload } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStreamCallbacks, ChatStreamPayload, ModelRuntimeHooks } from '../index';
import { LobeOpenAI, ModelRuntime } from '../index';
import { providerRuntimeMap } from '../runtimeMap';
import type { CreateImagePayload } from '../types/image';

/**
 * Mock createTraceOptions for testing purposes.
 * This avoids importing from @/server/modules/ModelRuntime which has database dependencies.
 */
const createMockTraceOptions = (callbacks?: Partial<ChatStreamCallbacks>) => ({
  callback: {
    onCompletion: callbacks?.onCompletion ?? vi.fn(),
    onFinal: callbacks?.onFinal ?? vi.fn(),
    onStart: callbacks?.onStart ?? vi.fn(),
    onToolsCalling: callbacks?.onToolsCalling ?? vi.fn(),
  } as ChatStreamCallbacks,
  headers: new Headers(),
});

const specialProviders = [
  { id: 'openai', payload: { apiKey: 'user-openai-key', baseURL: 'user-endpoint' } },
  {
    id: ModelProvider.Azure,
    payload: {
      apiKey: 'user-azure-key',
      baseURL: 'user-azure-endpoint',
      apiVersion: '2024-06-01',
    },
  },
  {
    id: ModelProvider.AzureAI,
    payload: {
      apiKey: 'user-azure-key',
      baseURL: 'user-azure-endpoint',
    },
  },
  {
    id: ModelProvider.Bedrock,
    payload: {
      accessKeyId: 'user-aws-id',
      accessKeySecret: 'user-aws-secret',
      region: 'user-aws-region',
    },
  },
  {
    id: ModelProvider.Ollama,
    payload: { baseURL: 'https://user-ollama-url' },
  },
  {
    id: ModelProvider.Cloudflare,
    payload: { baseURLOrAccountID: 'https://user-ollama-url' },
  },
];

const testRuntime = (providerId: string, payload?: any) => {
  describe(`${providerId} provider runtime`, () => {
    it('should initialize correctly', async () => {
      const jwtPayload: ClientSecretPayload = { apiKey: 'user-key', ...payload };
      const runtime = await ModelRuntime.initializeWithProvider(providerId, jwtPayload);

      // @ts-ignore
      expect(runtime['_runtime']).toBeInstanceOf(providerRuntimeMap[providerId]);

      if (payload?.baseURL) {
        expect(runtime['_runtime'].baseURL).toBe(payload.baseURL);
      }
    });
  });
};

let mockModelRuntime: ModelRuntime;
beforeEach(async () => {
  const jwtPayload: ClientSecretPayload = { apiKey: 'user-openai-key', baseURL: 'user-endpoint' };
  mockModelRuntime = await ModelRuntime.initializeWithProvider(ModelProvider.OpenAI, jwtPayload);
});

describe('ModelRuntime', () => {
  describe('should initialize with various providers', () => {
    const providers = Object.values(ModelProvider).filter((i) => i !== 'lobehub');
    const specialProviderIds = [ModelProvider.VertexAI, ...specialProviders.map((p) => p.id)];

    const generalTestProviders = providers.filter(
      (provider) => !specialProviderIds.includes(provider),
    );

    generalTestProviders.forEach((provider) => {
      testRuntime(provider);
    });

    specialProviders.forEach(({ id, payload }) => testRuntime(id, payload));
  });

  describe('ModelRuntime chat method', () => {
    it('should run correctly', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello, world!' }],
        model: 'text-davinci-002',
        temperature: 0,
      };

      vi.spyOn(LobeOpenAI.prototype, 'chat').mockResolvedValue(new Response(''));

      await mockModelRuntime.chat(payload);
    });
    it('should handle options with callbacks correctly', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello, world!' }],
        model: 'text-davinci-002',
        temperature: 0,
      };

      vi.spyOn(LobeOpenAI.prototype, 'chat').mockResolvedValue(new Response(''));

      await mockModelRuntime.chat(payload, createMockTraceOptions());
    });

    describe('callback', () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello, world!' }],
        model: 'text-davinci-002',
        temperature: 0,
      };

      it('should call onToolsCalling correctly', async () => {
        const onToolsCallingMock = vi.fn();

        vi.spyOn(LobeOpenAI.prototype, 'chat').mockImplementation(
          async (_payload, { callback }: any) => {
            if (callback?.onToolsCalling) {
              await callback.onToolsCalling();
            }
            return new Response('abc');
          },
        );

        await mockModelRuntime.chat(
          payload,
          createMockTraceOptions({ onToolsCalling: onToolsCallingMock }),
        );

        expect(onToolsCallingMock).toHaveBeenCalled();
      });

      it('should call onStart correctly', async () => {
        const onStartMock = vi.fn();

        vi.spyOn(LobeOpenAI.prototype, 'chat').mockImplementation(
          async (_payload, { callback }: any) => {
            if (callback?.onStart) {
              callback.onStart();
            }
            return new Response('Success');
          },
        );

        await mockModelRuntime.chat(payload, createMockTraceOptions({ onStart: onStartMock }));

        expect(onStartMock).toHaveBeenCalled();
      });

      it('should call onCompletion correctly', async () => {
        const onCompletionMock = vi.fn();

        vi.spyOn(LobeOpenAI.prototype, 'chat').mockImplementation(
          async (_payload, { callback }: any) => {
            if (callback?.onCompletion) {
              await callback.onCompletion({ text: 'Test completion' });
            }
            return new Response('Success');
          },
        );

        await mockModelRuntime.chat(
          payload,
          createMockTraceOptions({ onCompletion: onCompletionMock }),
        );

        expect(onCompletionMock).toHaveBeenCalledWith({ text: 'Test completion' });
      });

      it('should call onFinal correctly', async () => {
        const onFinalMock = vi.fn();

        vi.spyOn(LobeOpenAI.prototype, 'chat').mockImplementation(
          async (_payload, { callback }: any) => {
            if (callback?.onFinal) {
              await callback.onFinal('Test completion');
            }
            return new Response('Success');
          },
        );

        await mockModelRuntime.chat(payload, createMockTraceOptions({ onFinal: onFinalMock }));

        expect(onFinalMock).toHaveBeenCalledWith('Test completion');
      });
    });
  });

  describe('ModelRuntime generateObject method', () => {
    it('should run correctly', async () => {
      const payload = {
        model: 'gpt-4',
        messages: [{ role: 'user' as const, content: 'Generate a JSON object' }],
        schema: {
          name: 'PersonSchema',
          schema: {
            type: 'object' as const,
            properties: { name: { type: 'string' } },
          },
        },
      };

      const mockResponse = { name: 'John Doe' };

      vi.spyOn(LobeOpenAI.prototype, 'generateObject').mockResolvedValue(mockResponse);

      const result = await mockModelRuntime.generateObject(payload);

      expect(LobeOpenAI.prototype.generateObject).toHaveBeenCalledWith(payload, undefined);
      expect(result).toBe(mockResponse);
    });
  });

  describe('ModelRuntime createImage method', () => {
    it('should run correctly', async () => {
      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'A beautiful sunset over mountains',
          width: 1024,
          height: 1024,
        },
      };

      const mockResponse = {
        imageUrl: 'https://example.com/image.jpg',
        width: 1024,
        height: 1024,
      };

      vi.spyOn(LobeOpenAI.prototype, 'createImage').mockResolvedValue(mockResponse);

      const result = await mockModelRuntime.createImage(payload);

      expect(LobeOpenAI.prototype.createImage).toHaveBeenCalledWith(payload);
      expect(result).toBe(mockResponse);
    });

    it('should handle undefined createImage method gracefully', async () => {
      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'A beautiful sunset over mountains',
          width: 1024,
          height: 1024,
        },
      };

      // Mock runtime without createImage method
      const runtimeWithoutCreateImage = {
        createImage: undefined,
      };

      // @ts-ignore - testing edge case
      mockModelRuntime['_runtime'] = runtimeWithoutCreateImage;

      const result = await mockModelRuntime.createImage(payload);

      expect(result).toBeUndefined();
    });
  });

  describe('ModelRuntime models method', () => {
    it('should run correctly', async () => {
      const mockModels = [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      ];

      vi.spyOn(LobeOpenAI.prototype, 'models').mockResolvedValue(mockModels);

      const result = await mockModelRuntime.models();

      expect(LobeOpenAI.prototype.models).toHaveBeenCalled();
      expect(result).toBe(mockModels);
    });

    it('should handle undefined models method gracefully', async () => {
      // Mock runtime without models method
      const runtimeWithoutModels = {
        models: undefined,
      };

      // @ts-ignore - testing edge case
      mockModelRuntime['_runtime'] = runtimeWithoutModels;

      const result = await mockModelRuntime.models();

      expect(result).toBeUndefined();
    });
  });

  describe('ModelRuntime embeddings method', () => {
    it('should run correctly', async () => {
      const payload = {
        model: 'text-embedding-ada-002',
        input: 'Hello world',
      };

      const mockEmbeddings = [[0.1, 0.2, 0.3]];

      vi.spyOn(LobeOpenAI.prototype, 'embeddings').mockResolvedValue(mockEmbeddings);

      const result = await mockModelRuntime.embeddings(payload);

      expect(LobeOpenAI.prototype.embeddings).toHaveBeenCalledWith(payload, undefined);
      expect(result).toBe(mockEmbeddings);
    });

    it('should handle options correctly', async () => {
      const payload = {
        model: 'text-embedding-ada-002',
        input: 'Hello world',
      };

      const options = {};

      const mockEmbeddings = [[0.1, 0.2, 0.3]];

      vi.spyOn(LobeOpenAI.prototype, 'embeddings').mockResolvedValue(mockEmbeddings);

      const result = await mockModelRuntime.embeddings(payload, options);

      expect(LobeOpenAI.prototype.embeddings).toHaveBeenCalledWith(payload, options);
      expect(result).toBe(mockEmbeddings);
    });

    it('should handle undefined embeddings method gracefully', async () => {
      const payload = {
        model: 'text-embedding-ada-002',
        input: 'Hello world',
      };

      // Mock runtime without embeddings method
      const runtimeWithoutEmbeddings = {
        embeddings: undefined,
      };

      // @ts-ignore - testing edge case
      mockModelRuntime['_runtime'] = runtimeWithoutEmbeddings;

      const result = await mockModelRuntime.embeddings(payload);

      expect(result).toBeUndefined();
    });
  });

  describe('ModelRuntime textToSpeech method', () => {
    it('should run correctly', async () => {
      const payload = {
        model: 'tts-1',
        input: 'Hello world',
        voice: 'alloy',
      };

      const mockResponse = new ArrayBuffer(8);

      vi.spyOn(LobeOpenAI.prototype, 'textToSpeech').mockResolvedValue(mockResponse);

      const result = await mockModelRuntime.textToSpeech(payload);

      expect(LobeOpenAI.prototype.textToSpeech).toHaveBeenCalledWith(payload, undefined);
      expect(result).toBe(mockResponse);
    });

    it('should handle options correctly', async () => {
      const payload = {
        model: 'tts-1',
        input: 'Hello world',
        voice: 'alloy',
      };

      const options = {};

      const mockResponse = new ArrayBuffer(8);

      vi.spyOn(LobeOpenAI.prototype, 'textToSpeech').mockResolvedValue(mockResponse);

      const result = await mockModelRuntime.textToSpeech(payload, options);

      expect(LobeOpenAI.prototype.textToSpeech).toHaveBeenCalledWith(payload, options);
      expect(result).toBe(mockResponse);
    });

    it('should handle undefined textToSpeech method gracefully', async () => {
      const payload = {
        model: 'tts-1',
        input: 'Hello world',
        voice: 'alloy',
      };

      // Mock runtime without textToSpeech method
      const runtimeWithoutTextToSpeech = {
        textToSpeech: undefined,
      };

      // @ts-ignore - testing edge case
      mockModelRuntime['_runtime'] = runtimeWithoutTextToSpeech;

      const result = await mockModelRuntime.textToSpeech(payload);

      expect(result).toBeUndefined();
    });
  });

  describe('ModelRuntime pullModel method', () => {
    it('should run correctly', async () => {
      const params = {
        model: 'llama2',
      };

      const mockResponse = new Response('Success');
      const mockPullModel = vi.fn().mockResolvedValue(mockResponse);

      // Mock runtime with pullModel method
      mockModelRuntime['_runtime'].pullModel = mockPullModel;

      const result = await mockModelRuntime.pullModel(params);

      expect(mockPullModel).toHaveBeenCalledWith(params, undefined);
      expect(result).toBe(mockResponse);
    });

    it('should handle options correctly', async () => {
      const params = {
        model: 'llama2',
      };

      const options = {};

      const mockResponse = new Response('Success');
      const mockPullModel = vi.fn().mockResolvedValue(mockResponse);

      // Mock runtime with pullModel method
      mockModelRuntime['_runtime'].pullModel = mockPullModel;

      const result = await mockModelRuntime.pullModel(params, options);

      expect(mockPullModel).toHaveBeenCalledWith(params, options);
      expect(result).toBe(mockResponse);
    });

    it('should handle undefined pullModel method gracefully', async () => {
      const params = {
        model: 'llama2',
      };

      // Mock runtime without pullModel method
      const runtimeWithoutPullModel = {
        pullModel: undefined,
      };

      // @ts-ignore - testing edge case
      mockModelRuntime['_runtime'] = runtimeWithoutPullModel;

      const result = await mockModelRuntime.pullModel(params);

      expect(result).toBeUndefined();
    });
  });

  describe('hooks', () => {
    const createMockRuntime = (hooks?: ModelRuntimeHooks) => {
      const mockRuntimeAI = { chat: vi.fn(), embeddings: vi.fn(), generateObject: vi.fn() } as any;
      return { runtime: new ModelRuntime(mockRuntimeAI, hooks), mockRuntimeAI };
    };

    const chatPayload: ChatStreamPayload = {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-4',
      temperature: 0,
    };

    const genObjPayload = {
      messages: [{ role: 'user' as const, content: 'gen' }],
      model: 'gpt-4',
      schema: { name: 'test', schema: { type: 'object' as const, properties: {} } },
    };

    describe('chat hooks', () => {
      it('beforeChat is called before runtime.chat', async () => {
        const beforeChat = vi.fn();
        const { runtime, mockRuntimeAI } = createMockRuntime({ beforeChat });
        mockRuntimeAI.chat.mockResolvedValue(new Response(''));

        await runtime.chat(chatPayload);

        expect(beforeChat).toHaveBeenCalledWith(chatPayload, undefined);
        expect(mockRuntimeAI.chat).toHaveBeenCalled();
      });

      it('beforeChat throwing aborts chat call', async () => {
        const beforeChat = vi.fn().mockRejectedValue(new Error('budget exceeded'));
        const { runtime, mockRuntimeAI } = createMockRuntime({ beforeChat });

        await expect(runtime.chat(chatPayload)).rejects.toThrow('budget exceeded');
        expect(mockRuntimeAI.chat).not.toHaveBeenCalled();
      });

      it('beforeChat throwing triggers onChatError before re-throwing', async () => {
        const budgetError = { errorType: 'FreePlanLimit', error: { message: 'Budget exceeded' } };
        const beforeChat = vi.fn().mockRejectedValue(budgetError);
        const onChatError = vi.fn();
        const { runtime, mockRuntimeAI } = createMockRuntime({ beforeChat, onChatError });

        await expect(runtime.chat(chatPayload)).rejects.toBe(budgetError);
        expect(mockRuntimeAI.chat).not.toHaveBeenCalled();
        expect(onChatError).toHaveBeenCalledWith(budgetError, {
          options: undefined,
          payload: chatPayload,
        });
      });

      it('onChatFinal is injected into callback chain, existing onFinal called first', async () => {
        const callOrder: string[] = [];
        const existingOnFinal = vi.fn().mockImplementation(() => callOrder.push('existing'));
        const onChatFinal = vi.fn().mockImplementation(() => callOrder.push('hook'));
        const { runtime, mockRuntimeAI } = createMockRuntime({ onChatFinal });

        mockRuntimeAI.chat.mockImplementation(async (_p: any, opts: any) => {
          await opts?.callback?.onFinal?.({ id: 'msg-1', text: 'hello' });
          return new Response('');
        });

        await runtime.chat(chatPayload, { callback: { onFinal: existingOnFinal } });

        expect(existingOnFinal).toHaveBeenCalled();
        expect(onChatFinal).toHaveBeenCalled();
        expect(callOrder).toEqual(['existing', 'hook']);
      });

      it('onChatFinal receives data and context', async () => {
        const onChatFinal = vi.fn();
        const { runtime, mockRuntimeAI } = createMockRuntime({ onChatFinal });
        const options = { callback: {} };
        const finalData = { id: 'msg-1', text: 'hello' };

        mockRuntimeAI.chat.mockImplementation(async (_p: any, opts: any) => {
          await opts?.callback?.onFinal?.(finalData);
          return new Response('');
        });

        await runtime.chat(chatPayload, options);

        expect(onChatFinal).toHaveBeenCalledWith(finalData, {
          options,
          payload: chatPayload,
        });
      });

      it('onChatError is called when chat throws, error is re-thrown', async () => {
        const chatError = { errorType: 'ProviderBizError', error: new Error('fail') };
        const onChatError = vi.fn();
        const { runtime, mockRuntimeAI } = createMockRuntime({ onChatError });
        mockRuntimeAI.chat.mockRejectedValue(chatError);

        await expect(runtime.chat(chatPayload)).rejects.toBe(chatError);
        expect(onChatError).toHaveBeenCalledWith(chatError, {
          options: undefined,
          payload: chatPayload,
        });
      });

      it('works without hooks (undefined)', async () => {
        const { runtime, mockRuntimeAI } = createMockRuntime(undefined);
        mockRuntimeAI.chat.mockResolvedValue(new Response(''));

        await expect(runtime.chat(chatPayload)).resolves.toBeInstanceOf(Response);
      });
    });

    describe('generateObject hooks', () => {
      it('beforeGenerateObject is called before runtime.generateObject', async () => {
        const beforeGenerateObject = vi.fn();
        const { runtime, mockRuntimeAI } = createMockRuntime({ beforeGenerateObject });
        mockRuntimeAI.generateObject.mockResolvedValue({ result: 'ok' });

        await runtime.generateObject(genObjPayload);

        expect(beforeGenerateObject).toHaveBeenCalledWith(genObjPayload, undefined);
        expect(mockRuntimeAI.generateObject).toHaveBeenCalled();
      });

      it('beforeGenerateObject throwing aborts generateObject call', async () => {
        const beforeGenerateObject = vi.fn().mockRejectedValue(new Error('budget exceeded'));
        const { runtime, mockRuntimeAI } = createMockRuntime({ beforeGenerateObject });

        await expect(runtime.generateObject(genObjPayload)).rejects.toThrow('budget exceeded');
        expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
      });

      it('beforeGenerateObject throwing triggers onGenerateObjectError before re-throwing', async () => {
        const budgetError = { errorType: 'FreePlanLimit', error: { message: 'Budget exceeded' } };
        const beforeGenerateObject = vi.fn().mockRejectedValue(budgetError);
        const onGenerateObjectError = vi.fn();
        const { runtime, mockRuntimeAI } = createMockRuntime({
          beforeGenerateObject,
          onGenerateObjectError,
        });

        await expect(runtime.generateObject(genObjPayload)).rejects.toBe(budgetError);
        expect(mockRuntimeAI.generateObject).not.toHaveBeenCalled();
        expect(onGenerateObjectError).toHaveBeenCalledWith(budgetError, {
          options: undefined,
          payload: genObjPayload,
        });
      });

      it('onGenerateObjectFinal wraps onUsage, existing onUsage called first', async () => {
        const callOrder: string[] = [];
        const existingOnUsage = vi.fn().mockImplementation(() => callOrder.push('existing'));
        const onGenerateObjectFinal = vi.fn().mockImplementation(() => callOrder.push('hook'));
        const { runtime, mockRuntimeAI } = createMockRuntime({ onGenerateObjectFinal });
        const usage = { totalTokens: 100, promptTokens: 50, completionTokens: 50 };

        mockRuntimeAI.generateObject.mockImplementation(async (_p: any, opts: any) => {
          await opts?.onUsage?.(usage);
          return { result: 'ok' };
        });

        await runtime.generateObject(genObjPayload, { onUsage: existingOnUsage });

        expect(existingOnUsage).toHaveBeenCalledWith(usage);
        expect(onGenerateObjectFinal).toHaveBeenCalled();
        expect(callOrder).toEqual(['existing', 'hook']);
      });

      it('onGenerateObjectError is called when generateObject throws, error is re-thrown', async () => {
        const genError = { errorType: 'ProviderBizError', error: new Error('fail') };
        const onGenerateObjectError = vi.fn();
        const { runtime, mockRuntimeAI } = createMockRuntime({ onGenerateObjectError });
        mockRuntimeAI.generateObject.mockRejectedValue(genError);

        await expect(runtime.generateObject(genObjPayload)).rejects.toBe(genError);
        expect(onGenerateObjectError).toHaveBeenCalledWith(genError, {
          options: undefined,
          payload: genObjPayload,
        });
      });

      it('works without hooks (undefined)', async () => {
        const { runtime, mockRuntimeAI } = createMockRuntime(undefined);
        mockRuntimeAI.generateObject.mockResolvedValue({ result: 'ok' });

        await expect(runtime.generateObject(genObjPayload)).resolves.toEqual({ result: 'ok' });
      });
    });

    describe('embeddings hooks', () => {
      const embeddingsPayload = { model: 'text-embedding-ada-002', input: 'hello' };

      it('beforeEmbeddings throwing triggers onEmbeddingsError before re-throwing', async () => {
        const budgetError = { errorType: 'FreePlanLimit', error: { message: 'Budget exceeded' } };
        const beforeEmbeddings = vi.fn().mockRejectedValue(budgetError);
        const onEmbeddingsError = vi.fn();
        const { runtime, mockRuntimeAI } = createMockRuntime({
          beforeEmbeddings,
          onEmbeddingsError,
        });

        await expect(runtime.embeddings(embeddingsPayload)).rejects.toBe(budgetError);
        expect(mockRuntimeAI.embeddings).not.toHaveBeenCalled();
        expect(onEmbeddingsError).toHaveBeenCalledWith(budgetError, {
          options: undefined,
          payload: embeddingsPayload,
        });
      });
    });
  });
});
