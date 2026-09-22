// @vitest-environment node
import type { ILobeAgentRuntimeErrorType } from '@lobechat/types';
import { describe } from 'vitest';

import { createOpenAICompatibleRuntime } from './core/openaiCompatibleFactory';
import { testProvider } from './providerTestUtils';

// Provider plumbing compares error codes as strings; this suite intentionally
// uses non-canonical codes to prove pass-through, which the factory's narrow
// ILobeAgentRuntimeErrorType cannot express.
const customErrorType = (value: string) => value as ILobeAgentRuntimeErrorType;

// testProvider registers its own suites, so it must be called at suite-definition
// time. Build the runtime with the real factory so the generated tests exercise
// the actual chat/error/debug behaviour they assert.
const createTestRuntime = () =>
  createOpenAICompatibleRuntime({
    baseURL: 'https://default.test',
    debug: {
      chatCompletion: () => process.env.TEST_DEBUG === '1',
    },
    errorType: {
      bizError: customErrorType('TestBizError'),
      invalidAPIKey: customErrorType('InvalidAPIKey'),
    },
    provider: 'TestProvider',
  });

describe('testProvider', () => {
  describe('should run provider tests correctly', () => {
    testProvider({
      Runtime: createTestRuntime(),
      bizErrorType: 'TestBizError',
      chatDebugEnv: 'TEST_DEBUG',
      chatModel: 'test-model',
      defaultBaseURL: 'https://default.test',
      invalidErrorType: 'InvalidAPIKey',
      provider: 'TestProvider',
    });
  });

  describe('should handle OpenAI API errors correctly', () => {
    testProvider({
      Runtime: createTestRuntime(),
      bizErrorType: 'TestBizError',
      chatDebugEnv: 'TEST_DEBUG',
      chatModel: 'test-model',
      defaultBaseURL: 'https://default.test',
      invalidErrorType: 'InvalidAPIKey',
      provider: 'TestProvider',
    });
  });

  describe('should handle debug stream correctly', () => {
    testProvider({
      Runtime: createTestRuntime(),
      bizErrorType: 'TestBizError',
      chatDebugEnv: 'TEST_DEBUG',
      chatModel: 'test-model',
      defaultBaseURL: 'https://default.test',
      invalidErrorType: 'InvalidAPIKey',
      provider: 'TestProvider',
    });
  });
});
