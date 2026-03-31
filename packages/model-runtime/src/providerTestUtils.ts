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
  responseDebugEnv?: string;
  Runtime: any;
  test?: {
    skipAPICall?: boolean;
    skipErrorHandle?: boolean;
    useResponsesAPI?: boolean;
  };
}

export const testProvider = ({
  provider,
  invalidErrorType = 'InvalidProviderAPIKey',
  bizErrorType = 'ProviderBizError',
  defaultBaseURL,
  Runtime,
  chatDebugEnv,
  responseDebugEnv,
  chatModel,
  test = {},
}: TesstProviderParams) => {
  // Mock the console.error to avoid polluting test output
  vi.spyOn(console, 'error').mockImplementation(() => {});

  let instance: LobeOpenAICompatibleRuntime;

  beforeEach(() => {
    instance = new Runtime({ apiKey: 'test' });

    // Use vi.spyOn to mock the chat.completions.create method or responses.create method
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
    vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(new ReadableStream() as any);
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

        const createMethod = test?.useResponsesAPI
          ? instance['client'].responses.create
          : instance['client'].chat.completions.create;
        (createMethod as Mock).mockResolvedValue(mockResponse);

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

          const createMethod = test?.useResponsesAPI
            ? instance['client'].responses.create
            : instance['client'].chat.completions.create;
          (createMethod as Mock).mockResolvedValue(mockResponse);

          // Act
          const result = await instance.chat({
            max_tokens: 1024,
            messages: [{ content: 'Hello', role: 'user' }],
            model: chatModel,
            temperature: 0.7,
            top_p: 1,
          });

          // Assert
          if (test?.useResponsesAPI) {
            expect(instance['client'].responses.create).toHaveBeenCalled();
          } else {
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
          }
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

            if (test?.useResponsesAPI) {
              vi.mocked(instance['client'].responses.create).mockRejectedValue(apiError);
            } else {
              vi.mocked(instance['client'].chat.completions.create).mockRejectedValue(apiError);
            }

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

            if (test?.useResponsesAPI) {
              vi.mocked(instance['client'].responses.create).mockRejectedValue(apiError);
            } else {
              vi.mocked(instance['client'].chat.completions.create).mockRejectedValue(apiError);
            }

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

            if (test?.useResponsesAPI) {
              vi.spyOn(instance['client'].responses, 'create').mockRejectedValue(apiError);
            } else {
              vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);
            }

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

            if (test?.useResponsesAPI) {
              vi.mocked(instance['client'].responses.create).mockRejectedValue(error);
            } else {
              vi.mocked(instance['client'].chat.completions.create).mockRejectedValue(error);
            }

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
                error,
                errorType: invalidErrorType,
                provider,
              });
            }
          });

          it('should return AgentRuntimeError for non-OpenAI errors', async () => {
            // Arrange
            const genericError = new Error('Generic Error');

            if (test?.useResponsesAPI) {
              vi.mocked(instance['client'].responses.create).mockRejectedValue(genericError);
            } else {
              vi.mocked(instance['client'].chat.completions.create).mockRejectedValue(genericError);
            }

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
          const mockProdStream = new ReadableStream() as any; // Mocked prod stream
          const mockDebugStream = new ReadableStream({
            start(controller) {
              controller.enqueue('Debug stream content');
              controller.close();
            },
          }) as any;
          mockDebugStream.toReadableStream = () => mockDebugStream; // Add toReadableStream method

          // Mock the chat.completions.create return value, including the mocked tee method
          const createMethod = test?.useResponsesAPI
            ? instance['client'].responses.create
            : instance['client'].chat.completions.create;
          (createMethod as Mock).mockResolvedValue({
            tee: () => [mockProdStream, { toReadableStream: () => mockDebugStream }],
          });

          const debugEnv = test?.useResponsesAPI
            ? (responseDebugEnv ?? chatDebugEnv)
            : chatDebugEnv;
          // Save the original environment variable value
          const originalDebugValue = process.env[debugEnv];
          // Mock the environment variable
          process.env[debugEnv] = '1';
          vi.spyOn(debugStreamModule, 'debugStream').mockImplementation(() => Promise.resolve());

          // Execute the test
          // Run your test function, ensuring it calls debugStream when the condition is met
          // This is a hypothetical test function call; adjust according to actual usage
          await instance.chat({
            messages: [{ content: 'Hello', role: 'user' }],
            model: chatModel,
            stream: true,
            temperature: 0,
          });

          // Verify that debugStream was called
          expect(debugStreamModule.debugStream).toHaveBeenCalled();
          // Restore the original environment variable value
          process.env[debugEnv] = originalDebugValue;
        });
      });
    });
  });
};
