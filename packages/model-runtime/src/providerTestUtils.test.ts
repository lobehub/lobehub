import OpenAI from 'openai';
import { describe, vi } from 'vitest';

import { testProvider } from './providerTestUtils';
import * as debugStreamModule from './utils/debugStream';
import { desensitizeUrl } from './utils/desensitizeUrl';

const createMockRuntimeChat =
  (runtime: { baseURL: string; client: any }) =>
  async (payload: any): Promise<Response> => {
    try {
      const stream = await runtime.client.chat.completions.create(
        {
          ...payload,
          stream: true,
          stream_options: {
            include_usage: true,
          },
        },
        { headers: { Accept: '*/*' } },
      );

      const responseStream = stream.tee ? stream : new ReadableStream();

      if (process.env.TEST_DEBUG === '1' && responseStream.tee) {
        const [prod, debug] = responseStream.tee();
        const debugReadable =
          debug instanceof ReadableStream
            ? debug
            : debug.toReadableStream?.() || new ReadableStream();

        debugStreamModule.debugStream(debugReadable).catch(console.error);

        return new Response(prod);
      }

      return new Response(responseStream);
    } catch (error: any) {
      const endpoint = runtime.baseURL.includes('api.abc')
        ? desensitizeUrl(runtime.baseURL)
        : runtime.baseURL;

      if (error?.status === 401) {
        throw {
          endpoint,
          error,
          errorType: 'InvalidAPIKey',
          provider: 'TestProvider',
        };
      }

      if (error instanceof OpenAI.APIError) {
        throw {
          endpoint,
          error: error.error,
          errorType: 'TestBizError',
          message: error.message,
          provider: 'TestProvider',
        };
      }

      throw {
        endpoint,
        error: {
          cause: error?.cause,
          message: error?.message,
          name: error?.name,
        },
        errorType: 'AgentRuntimeError',
        message: error?.message,
        provider: 'TestProvider',
      };
    }
  };

describe('testProvider', () => {
  describe('runs provider tests correctly', () => {
    class MockRuntime {
      baseURL: string;
      client: any;

      constructor({
        apiKey,
        baseURL = 'https://default.test',
      }: {
        apiKey?: string;
        baseURL?: string;
      }) {
        if (!apiKey) throw { errorType: 'InvalidAPIKey' };
        this.baseURL = baseURL;
        this.client = {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue(new ReadableStream()),
            },
          },
          responses: {
            create: vi.fn().mockResolvedValue(new ReadableStream()),
          },
        };
      }

      async chat(params: any) {
        return createMockRuntimeChat(this)(params);
      }
    }

    testProvider({
      Runtime: MockRuntime,
      bizErrorType: 'TestBizError',
      chatDebugEnv: 'TEST_DEBUG',
      chatModel: 'test-model',
      defaultBaseURL: 'https://default.test',
      invalidErrorType: 'InvalidAPIKey',
      provider: 'TestProvider',
    });
  });

  describe('handles OpenAI API errors correctly', () => {
    class MockRuntime {
      baseURL: string;
      client: any;

      constructor({ apiKey, baseURL = 'test' }: { apiKey?: string; baseURL?: string }) {
        if (!apiKey) throw { errorType: 'InvalidAPIKey' };
        this.baseURL = baseURL;
        this.client = {
          chat: {
            completions: {
              create: vi.fn().mockRejectedValue(
                new OpenAI.APIError(
                  400,
                  {
                    error: { message: 'Test Error' },
                    status: 400,
                  },
                  'Test Error',
                  {},
                ),
              ),
            },
          },
          responses: {
            create: vi.fn().mockResolvedValue(new ReadableStream()),
          },
        };
      }

      async chat(params: any) {
        return createMockRuntimeChat(this)(params);
      }
    }

    testProvider({
      Runtime: MockRuntime,
      bizErrorType: 'TestBizError',
      chatDebugEnv: 'TEST_DEBUG',
      chatModel: 'test-model',
      defaultBaseURL: 'test',
      invalidErrorType: 'InvalidAPIKey',
      provider: 'TestProvider',
    });
  });

  describe('handles debug stream correctly', () => {
    class MockRuntime {
      baseURL: string;
      client: any;

      constructor({ apiKey, baseURL = 'test' }: { apiKey?: string; baseURL?: string }) {
        if (!apiKey) throw { errorType: 'InvalidAPIKey' };
        this.baseURL = baseURL;
        this.client = {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                tee: () => [new ReadableStream(), { toReadableStream: () => new ReadableStream() }],
              }),
            },
          },
          responses: {
            create: vi.fn().mockResolvedValue(new ReadableStream()),
          },
        };
      }

      async chat(params: any) {
        return createMockRuntimeChat(this)(params);
      }
    }

    testProvider({
      Runtime: MockRuntime,
      bizErrorType: 'TestBizError',
      chatDebugEnv: 'TEST_DEBUG',
      chatModel: 'test-model',
      defaultBaseURL: 'test',
      invalidErrorType: 'InvalidAPIKey',
      provider: 'TestProvider',
    });
  });
});
