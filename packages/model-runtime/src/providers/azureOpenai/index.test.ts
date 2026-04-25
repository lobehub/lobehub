// @vitest-environment node
import OpenAI from 'openai';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as nonStreamToStreamModule from '../../core/openaiCompatibleFactory/nonStreamToStream';
import * as streamsModule from '../../core/streams';
import * as debugStreamModule from '../../utils/debugStream';
import * as getModelPricingModule from '../../utils/getModelPricing';
import { LobeAzureOpenAI } from './index';

const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeAzureOpenAI', () => {
  let instance: LobeAzureOpenAI;

  beforeEach(() => {
    instance = new LobeAzureOpenAI({
      baseURL: 'https://test.openai.azure.com/',
      apiKey: 'test_key',
    });

    // 使用 vi.spyOn 来模拟 streamChatCompletions 方法
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(new ReadableStream() as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw InvalidAzureAPIKey error when apikey or endpoint is missing', () => {
      try {
        new LobeAzureOpenAI();
      } catch (e) {
        expect(e).toEqual({ errorType: invalidErrorType });
      }
    });

    it('should create an instance of OpenAIClient with correct parameters', () => {
      const baseURL = 'https://test.openai.azure.com/';
      const apiKey = 'test_key';

      const instance = new LobeAzureOpenAI({ baseURL, apiKey });

      expect(instance.client).toBeInstanceOf(OpenAI);
      expect(instance.baseURL).toBe('https://test.openai.azure.com/openai/v1');
    });
  });

  describe('chat', () => {
    it('should return a Response on successful API call', async () => {
      // Arrange
      const mockStream = new ReadableStream();
      const mockResponse = Promise.resolve(mockStream);

      (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'text-davinci-003',
        temperature: 0,
      });

      // Assert
      expect(result).toBeInstanceOf(Response);
    });

    describe('streaming response', () => {
      it('should use responses API and append web_search tool when enabledSearch is true', async () => {
        const mockProdStream = new ReadableStream() as any;
        const mockDebugStream = new ReadableStream() as any;
        const mockPricing = { units: [] };

        instance = new LobeAzureOpenAI({
          apiKey: 'test_key',
          baseURL: 'https://test.openai.azure.com/',
          id: 'lobehub',
        });

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          new ReadableStream() as any,
        );
        vi.spyOn(instance['client'].responses, 'create').mockResolvedValue({
          tee: () => [mockProdStream, mockDebugStream],
        } as any);
        vi.spyOn(getModelPricingModule, 'getModelPricing').mockResolvedValue(mockPricing as any);
        vi.spyOn(streamsModule, 'OpenAIResponsesStream').mockReturnValue(new ReadableStream());

        await instance.chat({
          enabledSearch: true,
          messages: [{ role: 'user', content: "Search for today's OpenAI news." }],
          model: 'gpt-5.4',
          reasoning_effort: 'medium',
          stream: true,
          top_p: 0.9,
          verbosity: 'high',
        } as any);

        expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();

        const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

        expect(createCall.input).toBeDefined();
        expect(createCall.model).toBe('gpt-5.4');
        expect(createCall.reasoning).toEqual({ effort: 'medium', summary: 'auto' });
        expect(createCall.store).toBe(false);
        expect(createCall.stream).toBe(true);
        expect(createCall.text).toEqual({ verbosity: 'high' });
        expect(createCall.top_p).toBeUndefined();
        expect(createCall.tools).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'web_search' })]),
        );

        expect(streamsModule.OpenAIResponsesStream).toHaveBeenCalledWith(
          mockProdStream,
          expect.objectContaining({
            inputStartAt: expect.any(Number),
            payload: {
              model: 'gpt-5.4',
              pricing: mockPricing,
              provider: 'lobehub',
            },
          }),
        );
      });

      it('should use deploymentName for Azure Responses API requests while keeping logical model for pricing', async () => {
        const mockProdStream = new ReadableStream() as any;
        const mockDebugStream = new ReadableStream() as any;
        const mockPricing = { units: [] };

        instance = new LobeAzureOpenAI({
          apiKey: 'test_key',
          baseURL: 'https://test.openai.azure.com/',
          id: 'lobehub',
        });

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          new ReadableStream() as any,
        );
        vi.spyOn(instance['client'].responses, 'create').mockResolvedValue({
          tee: () => [mockProdStream, mockDebugStream],
        } as any);
        vi.spyOn(getModelPricingModule, 'getModelPricing').mockResolvedValue(mockPricing as any);
        vi.spyOn(streamsModule, 'OpenAIResponsesStream').mockReturnValue(new ReadableStream());

        await instance.chat({
          deploymentName: 'prod-gpt-54',
          messages: [{ role: 'user', content: 'Hello' }],
          model: 'gpt-5.4',
          stream: true,
        } as any);

        expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();

        const createCall = (instance['client'].responses.create as Mock).mock.calls[0][0];

        expect(createCall.model).toBe('prod-gpt-54');
        expect(createCall.reasoning).toEqual({ summary: 'auto' });
        expect(createCall.deploymentName).toBeUndefined();

        expect(streamsModule.OpenAIResponsesStream).toHaveBeenCalledWith(
          mockProdStream,
          expect.objectContaining({
            payload: {
              model: 'gpt-5.4',
              pricing: mockPricing,
              provider: 'lobehub',
            },
          }),
        );
      });

      it('should strip unsupported params for Azure reasoning models and include usage in stream options', async () => {
        const mockProdStream = new ReadableStream() as any;
        const mockDebugStream = new ReadableStream() as any;
        const mockPricing = { units: [] };

        instance = new LobeAzureOpenAI({
          apiKey: 'test_key',
          baseURL: 'https://test.openai.azure.com/',
          id: 'lobehub',
        });

        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue({
          tee: () => [mockProdStream, mockDebugStream],
        } as any);
        vi.spyOn(getModelPricingModule, 'getModelPricing').mockResolvedValue(mockPricing as any);
        vi.spyOn(streamsModule, 'OpenAIStream').mockReturnValue(new ReadableStream());

        await instance.chat({
          frequency_penalty: 0.4,
          logit_bias: { '42': 1 },
          logprobs: true,
          max_tokens: 256,
          messages: [{ role: 'system', content: 'You are helpful.' }],
          model: 'o3',
          presence_penalty: 0.3,
          reasoning_effort: 'minimal',
          temperature: 0.7,
          top_logprobs: 2,
          top_p: 0.9,
        } as any);

        const createCall = (instance['client'].chat.completions.create as Mock).mock.calls[0][0];

        expect(createCall.frequency_penalty).toBeUndefined();
        expect(createCall.logit_bias).toBeUndefined();
        expect(createCall.logprobs).toBeUndefined();
        expect(createCall.max_tokens).toBeUndefined();
        expect(createCall.messages[0].role).toBe('developer');
        expect(createCall.presence_penalty).toBeUndefined();
        expect(createCall.reasoning_effort).toBe('low');
        expect(createCall.stream).toBe(true);
        expect(createCall.stream_options).toEqual({ include_usage: true });
        expect(createCall.temperature).toBeUndefined();
        expect(createCall.top_logprobs).toBeUndefined();
        expect(createCall.top_p).toBeUndefined();

        expect(getModelPricingModule.getModelPricing).toHaveBeenCalledWith('o3', 'lobehub');
        expect(streamsModule.OpenAIStream).toHaveBeenCalledWith(
          mockProdStream,
          expect.objectContaining({
            inputStartAt: expect.any(Number),
            payload: {
              model: 'o3',
              pricing: mockPricing,
              provider: 'lobehub',
            },
          }),
        );
      });

      it('should handle multiple data chunks correctly', async () => {
        const mockProdStream = new ReadableStream() as any;
        const mockDebugStream = new ReadableStream() as any;
        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue({
          tee: () => [mockProdStream, mockDebugStream],
        } as any);
        vi.spyOn(streamsModule, 'OpenAIStream').mockReturnValue(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: text\ndata: "你好！"\n\n'));
              controller.close();
            },
          }),
        );

        const result = await instance.chat({
          stream: true,
          max_tokens: 2048,
          temperature: 0.6,
          top_p: 1,
          model: 'gpt-35-turbo-16k',
          presence_penalty: 0,
          frequency_penalty: 0,
          messages: [{ role: 'user', content: '你好' }],
        });

        expect(result).toBeInstanceOf(Response);
        expect(streamsModule.OpenAIStream).toHaveBeenCalledWith(
          mockProdStream,
          expect.objectContaining({
            inputStartAt: expect.any(Number),
            payload: expect.objectContaining({
              model: 'gpt-35-turbo-16k',
              provider: 'azure',
            }),
          }),
        );
      });

      it('should handle non-streaming response', async () => {
        vi.spyOn(nonStreamToStreamModule, 'transformResponseToStream').mockImplementation(() => {
          return new ReadableStream();
        });
        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue({
          choices: [],
          created: 1715516381,
          id: 'chatcmpl-non-stream',
          model: 'gpt-35-turbo-16k',
          object: 'chat.completion',
        } as any);
        // Act
        await instance.chat({
          stream: false,
          temperature: 0.6,
          model: 'gpt-35-turbo-16k',
          messages: [{ role: 'user', content: '你好' }],
        });

        // Assert
        expect(nonStreamToStreamModule.transformResponseToStream).toHaveBeenCalled();
      });
    });

    it('should handle o1 series models without streaming', async () => {
      vi.spyOn(nonStreamToStreamModule, 'transformResponseToStream').mockImplementation(() => {
        return new ReadableStream();
      });
      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue({
        choices: [],
        created: 1715516381,
        id: 'chatcmpl-o1',
        model: 'o1-preview',
        object: 'chat.completion',
      } as any);

      // Act
      await instance.chat({
        temperature: 0.6,
        model: 'o1-preview',
        messages: [{ role: 'user', content: '你好' }],
      });

      // Assert
      expect(nonStreamToStreamModule.transformResponseToStream).toHaveBeenCalled();
    });

    describe('Error', () => {
      it('should return AzureBizError with DeploymentNotFound error', async () => {
        // Arrange
        const error = {
          code: 'DeploymentNotFound',
          message: 'Deployment not found',
        };

        (instance['client'].chat.completions.create as Mock).mockRejectedValue(error);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          // Assert
          expect(e).toEqual({
            endpoint: 'https://***.openai.azure.com/openai/v1',
            error: {
              code: 'DeploymentNotFound',
              message: 'Deployment not found',
              deployId: 'text-davinci-003',
            },
            errorType: bizErrorType,
            provider: 'azure',
          });
        }
      });

      it('should return AgentRuntimeError for non-Azure errors', async () => {
        // Arrange
        const genericError = new Error('Generic Error');

        (instance['client'].chat.completions.create as Mock).mockRejectedValue(genericError);

        // Act
        try {
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: 'text-davinci-003',
            temperature: 0,
          });
        } catch (e) {
          // Assert
          expect(e).toEqual({
            endpoint: 'https://***.openai.azure.com/openai/v1',
            errorType: 'AgentRuntimeError',
            provider: 'azure',
            error: {
              name: genericError.name,
              cause: genericError.cause,
              message: genericError.message,
            },
          });
        }
      });
    });

    describe('DEBUG', () => {
      it('should call debugStream when DEBUG_CHAT_COMPLETION is 1', async () => {
        // Arrange
        const mockProdStream = new ReadableStream() as any;
        const mockDebugStream = new ReadableStream() as any;

        (instance['client'].chat.completions.create as Mock).mockResolvedValue({
          tee: () => [mockProdStream, mockDebugStream],
        });

        process.env.DEBUG_AZURE_CHAT_COMPLETION = '1';
        vi.spyOn(debugStreamModule, 'debugStream').mockImplementation(() => Promise.resolve());
        vi.spyOn(streamsModule, 'OpenAIStream').mockReturnValue(new ReadableStream());

        // Act
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'text-davinci-003',
          temperature: 0,
        });

        // Assert
        expect(debugStreamModule.debugStream).toHaveBeenCalled();

        // Restore
        delete process.env.DEBUG_AZURE_CHAT_COMPLETION;
      });
    });
  });

  describe('createImage', () => {
    beforeEach(() => {
      // ensure images namespace exists and is spy-able
      expect(instance['client'].images).toBeTruthy();
    });

    it('should generate image and return url from object response', async () => {
      const url = 'https://example.com/image.png';
      const generateSpy = vi
        .spyOn(instance['client'].images, 'generate')
        .mockResolvedValue({ data: [{ url }] } as any);

      const res = await instance.createImage({
        model: 'gpt-image-1',
        params: { prompt: 'a cat' },
      });

      expect(generateSpy).toHaveBeenCalledTimes(1);
      const args = vi.mocked(generateSpy).mock.calls[0][0] as any;
      expect(args).not.toHaveProperty('image');
      expect(res).toEqual({ imageUrl: url });
    });

    it('should parse string JSON response from images.generate', async () => {
      const url = 'https://example.com/str.png';
      const payload = JSON.stringify({ data: [{ url }] });
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue(payload as any);

      const res = await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'dog' } });
      expect(res).toEqual({ imageUrl: url });
    });

    it('should parse bodyAsText JSON response', async () => {
      const url = 'https://example.com/bodyAsText.png';
      const bodyAsText = JSON.stringify({ data: [{ url }] });
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({ bodyAsText } as any);

      const res = await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'bird' } });
      expect(res).toEqual({ imageUrl: url });
    });

    it('should parse body JSON response', async () => {
      const url = 'https://example.com/body.png';
      const body = JSON.stringify({ data: [{ url }] });
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({ body } as any);

      const res = await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'fish' } });
      expect(res).toEqual({ imageUrl: url });
    });

    it('should prefer b64_json and return data URL', async () => {
      const b64 = 'AAA';
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
        data: [{ b64_json: b64 }],
      } as any);

      const res = await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'sun' } });
      expect(res.imageUrl).toBe(`data:image/png;base64,${b64}`);
    });

    it('should throw wrapped error for empty data array', async () => {
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({ data: [] } as any);

      await expect(
        instance.createImage({ model: 'gpt-image-1', params: { prompt: 'moon' } }),
      ).rejects.toMatchObject({
        endpoint: 'https://***.openai.azure.com/openai/v1',
        errorType: 'AgentRuntimeError',
        provider: 'azure',
        error: {
          name: 'Error',
          cause: undefined,
          message: expect.stringContaining('Invalid image response: missing or empty data array'),
        },
      });
    });

    it('should throw wrapped error when missing both b64_json and url', async () => {
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
        data: [{}],
      } as any);

      await expect(
        instance.createImage({ model: 'gpt-image-1', params: { prompt: 'stars' } }),
      ).rejects.toEqual({
        endpoint: 'https://***.openai.azure.com/openai/v1',
        errorType: 'AgentRuntimeError',
        provider: 'azure',
        error: {
          name: 'Error',
          cause: undefined,
          message: 'Invalid image response: missing both b64_json and url fields',
        },
      });
    });

    it('should call images.edit when imageUrl provided and strip size:auto', async () => {
      const url = 'https://example.com/edited.png';
      const editSpy = vi
        .spyOn(instance['client'].images, 'edit')
        .mockResolvedValue({ data: [{ url }] } as any);

      const helpers = await import('../../core/contextBuilders/openai');
      vi.spyOn(helpers, 'convertImageUrlToFile').mockResolvedValue({} as any);

      const res = await instance.createImage({
        model: 'gpt-image-1',
        params: { prompt: 'edit', imageUrl: 'https://example.com/in.png', size: 'auto' as any },
      });

      expect(editSpy).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(editSpy).mock.calls[0][0] as any;
      expect(arg).not.toHaveProperty('size');
      expect(arg).toHaveProperty('input_fidelity', 'high');
      expect(res).toEqual({ imageUrl: url });
    });

    it('should not send input_fidelity for gpt-image-2 edit requests', async () => {
      const url = 'https://example.com/gpt-image-2-edited.png';
      const editSpy = vi
        .spyOn(instance['client'].images, 'edit')
        .mockResolvedValue({ data: [{ url }] } as any);

      const helpers = await import('../../core/contextBuilders/openai');
      vi.spyOn(helpers, 'convertImageUrlToFile').mockResolvedValue({} as any);

      const res = await instance.createImage({
        model: 'gpt-image-2',
        params: { prompt: 'edit', imageUrl: 'https://example.com/in.png' },
      });

      expect(editSpy).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(editSpy).mock.calls[0][0] as any;
      expect(arg).not.toHaveProperty('input_fidelity');
      expect(res).toEqual({ imageUrl: url });
    });

    it('should convert multiple imageUrls and pass images array to edit', async () => {
      const url = 'https://example.com/edited2.png';
      const editSpy = vi
        .spyOn(instance['client'].images, 'edit')
        .mockResolvedValue({ data: [{ url }] } as any);

      const helpers = await import('../../core/contextBuilders/openai');
      const spy = vi.spyOn(helpers, 'convertImageUrlToFile').mockResolvedValue({} as any);

      await instance.createImage({
        model: 'gpt-image-1',
        params: { prompt: 'edit', imageUrls: ['u1', 'u2'] },
      });

      expect(spy).toHaveBeenCalledTimes(2);
      const arg = vi.mocked(editSpy).mock.calls[0][0] as any;
      expect(arg).toHaveProperty('image');
    });

    it('should not include image in generate options', async () => {
      const generateSpy = vi
        .spyOn(instance['client'].images, 'generate')
        .mockResolvedValue({ data: [{ url: 'https://x/y.png' }] } as any);

      await instance.createImage({ model: 'gpt-image-1', params: { prompt: 'no image' } });

      const arg = vi.mocked(generateSpy).mock.calls[0][0] as any;
      expect(arg).not.toHaveProperty('image');
    });
  });
});
