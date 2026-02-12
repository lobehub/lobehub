// @vitest-environment node
import { type LobeRuntimeAI } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_CHAT_AUTH_HEADER } from '@/envs/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { GET } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(),
}));

vi.mock('@/envs/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/envs/auth')>();
  return {
    ...actual,
  };
});

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

let request: Request;

beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    headers: {
      [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token',
    },
    method: 'GET',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET handler', () => {
  describe('error handling', () => {
    it('should not expose stack trace when an Error is thrown', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
      });

      const errorWithStack = new Error('Something went wrong');
      errorWithStack.stack =
        'Error: Something went wrong\n    at Object.<anonymous> (/path/to/file.ts:10:15)';

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(errorWithStack),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      // Should contain error name and message
      expect(responseBody.body.error.name).toBe('Error');
      expect(responseBody.body.error.message).toBe('Something went wrong');

      // Should NOT contain stack trace
      expect(responseBody.body.error.stack).toBeUndefined();

      // Verify JSON stringified response doesn't contain stack
      const responseText = JSON.stringify(responseBody);
      expect(responseText).not.toContain('/path/to/file.ts');
      expect(responseText).not.toContain('at Object');
    });

    it('should preserve error name for custom error types', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
      });

      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const customError = new CustomError('Custom error occurred');
      customError.stack = 'CustomError: Custom error occurred\n    at somewhere';

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(customError),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(responseBody.body.error.name).toBe('CustomError');
      expect(responseBody.body.error.message).toBe('Custom error occurred');
      expect(responseBody.body.error.stack).toBeUndefined();
    });

    it('should pass through structured error objects as-is', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
      });

      const structuredError = {
        errorType: ChatErrorType.InternalServerError,
        error: { code: 'PROVIDER_ERROR', details: 'API limit exceeded' },
      };

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(structuredError),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      // Structured error should be passed through
      expect(responseBody.body.error.code).toBe('PROVIDER_ERROR');
      expect(responseBody.body.error.details).toBe('API limit exceeded');
    });

    it('should return correct status code for errors', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
      });

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(new Error('Failed')),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });

      expect(response.status).toBe(500);
    });

    it('should include provider in error response', async () => {
      const mockParams = Promise.resolve({ provider: 'openai' });

      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
      });

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(new Error('Failed')),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(responseBody.body.provider).toBe('openai');
    });
  });

  describe('success cases', () => {
    it('should return model list on success', async () => {
      const mockParams = Promise.resolve({ provider: 'openai' });

      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
      });

      const mockModelList = [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      ];

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockResolvedValue(mockModelList),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(200);
      expect(responseBody).toEqual(mockModelList);
    });
  });
});
