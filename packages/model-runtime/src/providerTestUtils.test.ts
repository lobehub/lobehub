import OpenAI from 'openai';
import { describe, it, vi } from 'vitest';

import { testProvider } from './providerTestUtils';

describe('testProvider', () => {
  it('should run provider tests correctly', () => {
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
        };
      }

      async chat(params: any) {
        return this.client.chat.completions.create(params);
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

  it('should handle OpenAI API errors correctly', async () => {
    class MockRuntime {
      baseURL: string;
      client: any;

      constructor({ apiKey }: { apiKey?: string }) {
        if (!apiKey) throw { errorType: 'InvalidAPIKey' };
        this.baseURL = 'test';
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
        };
      }

      async chat(params: any) {
        return this.client.chat.completions.create(params);
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

  it('should handle debug stream correctly', () => {
    class MockRuntime {
      baseURL: string;
      client: any;

      constructor({ apiKey }: { apiKey?: string }) {
        if (!apiKey) throw { errorType: 'InvalidAPIKey' };
        this.baseURL = 'test';
        this.client = {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                tee: () => [new ReadableStream(), { toReadableStream: () => new ReadableStream() }],
              }),
            },
          },
        };
      }

      async chat(params: any) {
        return this.client.chat.completions.create(params);
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
