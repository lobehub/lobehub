import OpenAI from 'openai';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from './core/BaseAI';
import * as debugStreamModule from './utils/debugStream';

interface TesstProviderParams {
  bizErrorType?: string;
  chatDebugEnv: string;
  chatModel: string;
  defaultBaseURL: string;
  invalidErrorType?: string;
  provider: string;
  Runtime: any;
  test?: {
    skipAPICall?: boolean;
    skipErrorHandle?: boolean;
  };
}

export const testProvider = ({
  provider,
  invalidErrorType = 'InvalidProviderAPIKey',
  bizErrorType = 'ProviderBizError',
  defaultBaseURL,
  Runtime,
  chatDebugEnv,
  chatModel,
  test = {},
}: TesstProviderParams) => {
  // Mock the console.error to avoid polluting test output
  vi.spyOn(console, 'error').mockImplementation(() => {});

  let instance: LobeOpenAICompatibleRuntime;

  beforeEach(() => {
    instance = new Runtime({ apiKey: 'test' });

    // 使用 vi.spyOn 来模拟 chat.completions.create 方法
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe(`${provider} Runtime`, () => {
    describe('init', () => {
      it('should correctly initialize with an API key', async () => {
        const instance = new Runtime({ apiKey: 'test_api_key' });
        expect(instance).toBeInstanceOf(Runtime);
        expect(instance.baseURL).toEqual(defaultBaseURL);
      });
    });

    describe('chat', () => {
      it('should return a StreamingTextResponse on successful API call', async () => {
        // Arrange
        const mockStream = new ReadableStream();
        const mockResponse = Promise.resolve(mockStream);

        (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockResponse);

        // Act
        const result = await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: chatModel,
          temperature: 0,
        });

        // Assert
        expect(result).toBeInstanceOf(Response);
      });

      if (!test?.skipAPICall) {
        it(`should call ${provider} API with corresponding options`, async () => {
          // Arrange
          const mockStream = new ReadableStream();
          const mockResponse = Promise.resolve(mockStream);

          (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockResponse);

          // Act
          const result = await instance.chat({
            max_tokens: 1024,
            messages: [{ content: 'Hello', role: 'user' }],
            model: chatModel,
            temperature: 0.7,
            top_p: 1,
          });

          // Assert
          expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
            {
              max_tokens: 1024,
              messages: [{ content: 'Hello', role: 'user' }],
              model: chatModel,
              stream: true,
              stream_options: {
                include_usage: true,
              },
              temperature: 0.7,
              top_p: 1,
            },
            { headers: { Accept: '*/*' } },
          );
          expect(result).toBeInstanceOf(Response);
        });
      }

      if (!test.skipErrorHandle) {
        describe('Error', () => {
          it('should return ProviderBizError with an openai error response when OpenAI.APIError is thrown', async () => {
            // Arrange
            const apiError = new OpenAI.APIError(
              400,
              {
                error: {
                  message: 'Bad Request',
                },
                status: 400,
              },
              'Error message',
              {},
            );

            vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

            // Act
            try {
              await instance.chat({
                messages: [{ content: 'Hello', role: 'user' }],
                model: chatModel,
                temperature: 0,
              });
            } catch (e) {
              expect(e).toEqual({
                endpoint: defaultBaseURL,
                error: {
                  error: { message: 'Bad Request' },
                  status: 400,
                },
                errorType: bizErrorType,
                provider,
              });
            }
          });

          it('should throw AgentRuntimeError with InvalidProviderAPIKey if no apiKey is provided', async () => {
            try {
              new Runtime({});
            } catch (e) {
              expect(e).toEqual({ errorType: invalidErrorType });
            }
          });

          it('should return ProviderBizError with the cause when OpenAI.APIError is thrown with cause', async () => {
            // Arrange
            const errorInfo = {
              cause: {
                message: 'api is undefined',
              },
            };
            const apiError = new OpenAI.APIError(400, errorInfo, 'module error', {});

            vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

            // Act
            try {
              await instance.chat({
                messages: [{ content: 'Hello', role: 'user' }],
                model: chatModel,
                temperature: 0,
              });
            } catch (e) {
              expect(e).toEqual({
                endpoint: defaultBaseURL,
                error: {
                  cause: { message: 'api is undefined' },
                },
                errorType: bizErrorType,
                provider,
              });
            }
          });

          it('should return ProviderBizError with an cause response with desensitize Url', async () => {
            // Arrange
            const errorInfo = {
              cause: { message: 'api is undefined' },
            };
            const apiError = new OpenAI.APIError(400, errorInfo, 'module error', {});

            instance = new Runtime({
              apiKey: 'test',

              baseURL: 'https://api.abc.com/v1',
            });

            vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

            // Act
            try {
              await instance.chat({
                messages: [{ content: 'Hello', role: 'user' }],
                model: chatModel,
                temperature: 0,
              });
            } catch (e) {
              expect(e).toEqual({
                endpoint: 'https://api.***.com/v1',
                error: {
                  cause: { message: 'api is undefined' },
                },
                errorType: bizErrorType,
                provider,
              });
            }
          });

          it(`should throw an InvalidAPIKey error type on 401 status code`, async () => {
            // Mock the API call to simulate a 401 error
            const error = new Error('Unauthorized') as any;
            error.status = 401;
            vi.mocked(instance['client'].chat.completions.create).mockRejectedValue(error);

            try {
              await instance.chat({
                messages: [{ content: 'Hello', role: 'user' }],
                model: chatModel,
                temperature: 0,
              });
            } catch (e) {
              // Expect the chat method to throw an error with InvalidHunyuanAPIKey
              expect(e).toEqual({
                endpoint: defaultBaseURL,
                error: error,
                errorType: invalidErrorType,
                provider,
              });
            }
          });

          it('should return AgentRuntimeError for non-OpenAI errors', async () => {
            // Arrange
            const genericError = new Error('Generic Error');

            vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(genericError);

            // Act
            try {
              await instance.chat({
                messages: [{ content: 'Hello', role: 'user' }],
                model: chatModel,
                temperature: 0,
              });
            } catch (e) {
              expect(e).toEqual({
                endpoint: defaultBaseURL,
                error: {
                  cause: genericError.cause,
                  message: genericError.message,
                  name: genericError.name,
                },
                errorType: 'AgentRuntimeError',
                provider,
              });
            }
          });
        });
      }

      describe('DEBUG', () => {
        it(`should call debugStream and return StreamingTextResponse when ${chatDebugEnv} is 1`, async () => {
          // Arrange
          const mockProdStream = new ReadableStream() as any; // 模拟的 prod 流
          const mockDebugStream = new ReadableStream({
            start(controller) {
              controller.enqueue('Debug stream content');
              controller.close();
            },
          }) as any;
          mockDebugStream.toReadableStream = () => mockDebugStream; // 添加 toReadableStream 方法

          // 模拟 chat.completions.create 返回值，包括模拟的 tee 方法
          (instance['client'].chat.completions.create as Mock).mockResolvedValue({
            tee: () => [mockProdStream, { toReadableStream: () => mockDebugStream }],
          });

          // 保存原始环境变量值
          const originalDebugValue = process.env[chatDebugEnv];

          // 模拟环境变量
          process.env[chatDebugEnv] = '1';
          vi.spyOn(debugStreamModule, 'debugStream').mockImplementation(() => Promise.resolve());

          // 执行测试
          // 运行你的测试函数，确保它会在条件满足时调用 debugStream
          // 假设的测试函数调用，你可能需要根据实际情况调整
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: chatModel,
            stream: true,
            temperature: 0,
          });

          // 验证 debugStream 被调用
          expect(debugStreamModule.debugStream).toHaveBeenCalled();

          // 恢复原始环境变量值
          process.env[chatDebugEnv] = originalDebugValue;
        });
      });
    });
  });
};
