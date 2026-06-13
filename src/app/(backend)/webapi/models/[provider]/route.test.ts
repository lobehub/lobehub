// @vitest-environment node
import type { LobeRuntimeAI } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType, ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { GET } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

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
  vi.spyOn(console, 'error').mockImplementation(() => {});

  request = new Request(new URL('https://test.com'), {
    method: 'GET',
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('GET handler', () => {
  describe('error handling', () => {
    it('should return the thrown error message without exposing stack trace', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

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

      expect(response.status).toBe(500);
      expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
      expect(responseBody.body.message).toBe('Something went wrong');

      const responseText = JSON.stringify(responseBody);
      expect(responseText).not.toContain('/path/to/file.ts');
      expect(responseText).not.toContain('at Object');
    });

    it('should return custom error messages', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

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

      expect(response.status).toBe(500);
      expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
      expect(responseBody.body.message).toBe('Custom error occurred');
    });

    it('should preserve structured model fetch error context', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

      const structuredError = {
        errorType: AgentRuntimeErrorType.ProviderBizError,
        error: { code: 'PROVIDER_ERROR', message: 'API limit exceeded' },
      };

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(structuredError),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(471);
      expect(responseBody.errorType).toBe(AgentRuntimeErrorType.ProviderBizError);
      expect(responseBody.body.error.code).toBe('PROVIDER_ERROR');
      expect(responseBody.body.error.message).toBe('API limit exceeded');
      expect(responseBody.body.message).toBe('API limit exceeded');
      expect(responseBody.body.provider).toBe('google');
    });

    it('should return generic status code for model fetch errors', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(new Error('Failed')),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(500);
      expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
      expect(responseBody.body.message).toBe('Failed');
    });

    it('should prefer wrapped cause message for model fetch errors', async () => {
      const mockParams = Promise.resolve({ provider: 'openrouter' });

      const cause = new Error('OpenRouter models API request failed with status 401');
      const wrappedError = new Error('Failed to fetch OpenRouter models', { cause });

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn(),
        models: vi.fn().mockRejectedValue(wrappedError),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(500);
      expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
      expect(responseBody.body.message).toBe(
        'OpenRouter models API request failed with status 401',
      );
    });

    it('should return generic status code for setup errors', async () => {
      const mockParams = Promise.resolve({ provider: 'google' });

      vi.mocked(initModelRuntimeFromDB).mockRejectedValue(new Error('Setup failed'));

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(500);
      expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
      expect(responseBody.body.message).toBe('Setup failed');
    });

    it('should preserve structured setup error type and message', async () => {
      const mockParams = Promise.resolve({ provider: 'githubcopilot' });

      vi.mocked(initModelRuntimeFromDB).mockRejectedValue({
        error: { message: 'Invalid GitHub Copilot API key' },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      });

      const response = await GET(request, { params: mockParams });
      const responseBody = await response.json();

      expect(response.status).toBe(401);
      expect(responseBody.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      expect(responseBody.body.message).toBe('Invalid GitHub Copilot API key');
      expect(responseBody.body.error.message).toBe('Invalid GitHub Copilot API key');
      expect(responseBody.body.provider).toBe('githubcopilot');
    });

    it('should include provider in error response', async () => {
      const mockParams = Promise.resolve({ provider: 'openai' });

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
