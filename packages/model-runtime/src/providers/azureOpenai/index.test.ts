// @vitest-environment node
import { AzureOpenAI } from 'openai';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as openaiCompatibleFactoryModule from '../../core/openaiCompatibleFactory';
import * as debugStreamModule from '../../utils/debugStream';
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
      apiVersion: '2023-03-15-preview',
    });

    // 使用 vi.spyOn 来模拟 streamChatCompletions 方法
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
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
      const apiVersion = '2023-03-15-preview';

      const instance = new LobeAzureOpenAI({ baseURL, apiKey, apiVersion });

      expect(instance.client).toBeInstanceOf(AzureOpenAI);
      expect(instance.baseURL).toBe(baseURL);
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
      it('should handle multiple data chunks correctly', async () => {
        const data = [
          {
            choices: [],
            created: 0,
            id: '',
            model: '',
            object: '',
            prompt_filter_results: [
              {
                prompt_index: 0,
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
              },
            ],
          },
          {
            choices: [
              {
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
                delta: { content: '你' },
                finish_reason: null,
                index: 0,
                logprobs: null,
              },
            ],
            created: 1715516381,
            id: 'chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            model: 'gpt-35-turbo-16k',
            object: 'chat.completion.chunk',
            system_fingerprint: null,
          },
          {
            choices: [
              {
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
                delta: { content: '好' },
                finish_reason: null,
                index: 0,
                logprobs: null,
              },
            ],
            created: 1715516381,
            id: 'chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            model: 'gpt-35-turbo-16k',
            object: 'chat.completion.chunk',
            system_fingerprint: null,
          },
          {
            choices: [
              {
                content_filter_results: {
                  hate: { filtered: false, severity: 'safe' },
                  self_harm: { filtered: false, severity: 'safe' },
                  sexual: { filtered: false, severity: 'safe' },
                  violence: { filtered: false, severity: 'safe' },
                },
                delta: { content: '！' },
                finish_reason: null,
                index: 0,
                logprobs: null,
              },
            ],
            created: 1715516381,
            id: 'chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            model: 'gpt-35-turbo-16k',
            object: 'chat.completion.chunk',
            system_fingerprint: null,
          },
        ];

        const mockStream = new ReadableStream({
          start(controller) {
            data.forEach((chunk) => controller.enqueue(chunk));
            controller.close();
          },
        });
        vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
          mockStream as any,
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

        const decoder = new TextDecoder();
        const reader = result.body!.getReader();
        const stream: string[] = [];

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          stream.push(decoder.decode(value));
        }

        expect(stream).toEqual(
          [
            'id: ',
            'event: data',
            'data: {"choices":[],"created":0,"id":"","model":"","object":"","prompt_filter_results":[{"prompt_index":0,"content_filter_results":{"hate":{"filtered":false,"severity":"safe"},"self_harm":{"filtered":false,"severity":"safe"},"sexual":{"filtered":false,"severity":"safe"},"violence":{"filtered":false,"severity":"safe"}}}]}\n',
            'id: chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            'event: text',
            'data: "你"\n',
            'id: chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            'event: text',
            'data: "好"\n',
            'id: chatcmpl-9O2SzeGv5xy6yz0TcQNA1DHHLJ8N1',
            'event: text',
            'data: "！"\n',
          ].map((item) => `${item}\n`),
        );
      });

      it('should handle non-streaming response', async () => {
        vi.spyOn(openaiCompatibleFactoryModule, 'transformResponseToStream').mockImplementation(
          () => {
            return new ReadableStream();
          },
        );
        // Act
        await instance.chat({
          stream: false,
          temperature: 0.6,
          model: 'gpt-35-turbo-16k',
          messages: [{ role: 'user', content: '你好' }],
        });

        // Assert
        expect(openaiCompatibleFactoryModule.transformResponseToStream).toHaveBeenCalled();
      });
    });

    it('should handle o1 series models without streaming', async () => {
      vi.spyOn(openaiCompatibleFactoryModule, 'transformResponseToStream').mockImplementation(
        () => {
          return new ReadableStream();
        },
      );

      // Act
      await instance.chat({
        temperature: 0.6,
        model: 'o1-preview',
        messages: [{ role: 'user', content: '你好' }],
      });

      // Assert
      expect(openaiCompatibleFactoryModule.transformResponseToStream).toHaveBeenCalled();
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
            endpoint: 'https://***.openai.azure.com/',
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
            endpoint: 'https://***.openai.azure.com/',
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
        const mockDebugStream = new ReadableStream({
          start(controller) {
            controller.enqueue('Debug stream content');
            controller.close();
          },
        }) as any;
        mockDebugStream.toReadableStream = () => mockDebugStream;

        (instance['client'].chat.completions.create as Mock).mockResolvedValue({
          tee: () => [mockProdStream, { toReadableStream: () => mockDebugStream }],
        });

        process.env.DEBUG_AZURE_CHAT_COMPLETION = '1';
        vi.spyOn(debugStreamModule, 'debugStream').mockImplementation(() => Promise.resolve());

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
        endpoint: 'https://***.openai.azure.com/',
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
        endpoint: 'https://***.openai.azure.com/',
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

  describe('private method', () => {
    describe('tocamelCase', () => {
      it('should convert string to camel case', () => {
        const key = 'image_url';

        const camelCaseKey = instance['tocamelCase'](key);

        expect(camelCaseKey).toEqual('imageUrl');
      });
    });

    describe('camelCaseKeys', () => {
      it('should convert object keys to camel case', () => {
        const obj = {
          frequency_penalty: 0,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: '<image URL>',
                  },
                },
              ],
            },
          ],
        };

        const newObj = instance['camelCaseKeys'](obj);

        expect(newObj).toEqual({
          frequencyPenalty: 0,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  imageUrl: {
                    url: '<image URL>',
                  },
                },
              ],
            },
          ],
        });
      });
    });
  });
});
