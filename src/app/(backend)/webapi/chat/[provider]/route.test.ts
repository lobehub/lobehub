// @vitest-environment node
import { type LobeRuntimeAI } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { classifyLLMError } from '@/server/modules/AgentRuntime/llmErrorClassification';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { POST } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
  createTraceOptions: vi.fn().mockReturnValue({}),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/server/modules/AgentRuntime/llmErrorClassification', () => ({
  classifyLLMError: vi.fn(),
}));

// 模拟请求和响应
let request: Request;
beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    method: 'POST',
    body: JSON.stringify({ model: 'test-model' }),
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });

  // Default: errors are retryable
  vi.mocked(classifyLLMError).mockReturnValue({
    code: 'RATE_LIMIT',
    kind: 'retry',
    message: 'rate limit',
  });
});

afterEach(() => {
  vi.clearAllMocks();
  // Clean up retry env vars
  delete process.env.LLM_CHAT_MAX_RETRIES;
  delete process.env.LLM_CHAT_RETRY_BASE_DELAY_MS;
  delete process.env.LLM_CHAT_RETRY_MAX_DELAY_MS;
});

describe('POST handler', () => {
  describe('init chat model', () => {
    it('should initialize ModelRuntime correctly with valid session', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });

      const mockChatResponse = new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      await POST(request as unknown as Request, { params: mockParams });

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        'test-user-id',
        'test-provider',
        undefined,
      );
    });

    it('should return Unauthorized error when no session exists', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      const mockParams = Promise.resolve({ provider: 'test-provider' });

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(401);
    });
  });

  describe('chat', () => {
    it('should correctly handle chat completion with valid payload', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
      });

      const mockChatResponse: any = { success: true, message: 'Reply from agent' };
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request as unknown as Request, { params: mockParams });

      expect(response).toEqual(mockChatResponse);
      expect(mockRuntime.chat).toHaveBeenCalledWith(mockChatPayload, {
        user: 'test-user-id',
        signal: expect.anything(),
      });
    });

    it('should return an error response when chat completion fails', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
      });

      const mockErrorResponse = {
        errorType: ChatErrorType.InternalServerError,
        error: { errorMessage: 'Something went wrong', errorType: 500 },
        errorMessage: 'Something went wrong',
      };

      // Non-retryable error so no retry loop
      vi.mocked(classifyLLMError).mockReturnValue({
        kind: 'stop',
        message: 'Something went wrong',
      });

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockRejectedValue(mockErrorResponse),
      };

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        body: {
          errorMessage: 'Something went wrong',
          error: {
            errorMessage: 'Something went wrong',
            errorType: 500,
          },
          provider: 'test-provider',
        },
        errorType: 500,
      });
    });
  });

  describe('retry on transient errors', () => {
    // Helper: create a fresh Request for each retry test (body can only be read once)
    const makeRequest = (payload = { model: 'test-model' }) =>
      new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify(payload),
      });

    const mockParams = () => Promise.resolve({ provider: 'test-provider' });

    const transientError = {
      error: { message: '529 overloaded' },
      errorType: 'ProviderBizError',
    };

    const permanentError = {
      error: { message: 'invalid api key' },
      errorType: 'InvalidProviderAPIKey',
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should retry on transient error and succeed on second attempt', async () => {
      process.env.LLM_CHAT_MAX_RETRIES = '2';
      process.env.LLM_CHAT_RETRY_BASE_DELAY_MS = '100';

      vi.mocked(classifyLLMError).mockReturnValue({
        code: 'RATE_LIMIT',
        kind: 'retry',
        message: '529 overloaded',
      });

      const mockChatResponse = new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });

      const chatMock = vi
        .fn()
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(mockChatResponse);

      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: chatMock };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const promise = POST(makeRequest(), { params: mockParams() });

      // Advance past first backoff (100ms)
      await vi.advanceTimersByTimeAsync(200);

      const response = await promise;
      expect(chatMock).toHaveBeenCalledTimes(2);
      expect(response).toBe(mockChatResponse);
    });

    it('should not retry on permanent (stop) errors', async () => {
      process.env.LLM_CHAT_MAX_RETRIES = '3';

      vi.mocked(classifyLLMError).mockReturnValue({
        kind: 'stop',
        message: 'invalid api key',
      });

      const chatMock = vi.fn().mockRejectedValue(permanentError);
      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: chatMock };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(makeRequest(), { params: mockParams() });

      // Only called once — no retry for stop errors
      expect(chatMock).toHaveBeenCalledTimes(1);
      // InvalidProviderAPIKey → 401
      expect(response.status).toBe(401);
    });

    it('should exhaust all retries and return error response', async () => {
      process.env.LLM_CHAT_MAX_RETRIES = '2';
      process.env.LLM_CHAT_RETRY_BASE_DELAY_MS = '50';

      vi.mocked(classifyLLMError).mockReturnValue({
        code: 'RATE_LIMIT',
        kind: 'retry',
        message: '429 rate limit',
      });

      const chatMock = vi.fn().mockRejectedValue({
        errorType: ChatErrorType.InternalServerError,
        error: { errorMessage: 'rate limited' },
      });

      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: chatMock };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const promise = POST(makeRequest(), { params: mockParams() });

      // Advance past all backoff delays
      await vi.advanceTimersByTimeAsync(10_000);

      const response = await promise;

      // 1 initial + 2 retries = 3 total attempts
      expect(chatMock).toHaveBeenCalledTimes(3);
      expect(response.status).toBe(500);
    });

    it('should disable retries when LLM_CHAT_MAX_RETRIES=0', async () => {
      process.env.LLM_CHAT_MAX_RETRIES = '0';

      vi.mocked(classifyLLMError).mockReturnValue({
        kind: 'retry',
        message: 'transient',
      });

      const chatMock = vi.fn().mockRejectedValue(transientError);
      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: chatMock };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(makeRequest(), { params: mockParams() });

      // Only 1 attempt when retries = 0
      expect(chatMock).toHaveBeenCalledTimes(1);
      // ProviderBizError → 471
      expect(response.status).toBe(471);
    });

    it('should stop retrying when client aborts', async () => {
      process.env.LLM_CHAT_MAX_RETRIES = '3';
      process.env.LLM_CHAT_RETRY_BASE_DELAY_MS = '1000';

      vi.mocked(classifyLLMError).mockReturnValue({
        kind: 'retry',
        message: 'transient',
      });

      const abortController = new AbortController();
      const req = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify({ model: 'test-model' }),
        signal: abortController.signal,
      });

      const chatMock = vi.fn().mockRejectedValue(transientError);
      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: chatMock };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const promise = POST(req, { params: mockParams() });

      // Let first attempt fail, then abort during backoff
      await vi.advanceTimersByTimeAsync(100);
      abortController.abort();
      await vi.advanceTimersByTimeAsync(5000);

      const response = await promise;

      // Should not have retried all 4 attempts
      expect(chatMock.mock.calls.length).toBeLessThanOrEqual(2);
      // ProviderBizError → 471
      expect(response.status).toBe(471);
    });

    it('should use default retries when env var is invalid', async () => {
      process.env.LLM_CHAT_MAX_RETRIES = 'not-a-number';
      // Shrink base/max delay so the fake-timer advance stays small.
      process.env.LLM_CHAT_RETRY_BASE_DELAY_MS = '10';
      process.env.LLM_CHAT_RETRY_MAX_DELAY_MS = '20';

      vi.mocked(classifyLLMError).mockReturnValue({
        kind: 'retry',
        message: 'transient',
      });

      const chatMock = vi.fn().mockRejectedValue(transientError);
      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: chatMock };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const promise = POST(makeRequest(), { params: mockParams() });

      // Advance past all backoff delays (default 10 retries → 11 attempts)
      await vi.advanceTimersByTimeAsync(5_000);

      const response = await promise;

      // Default is 10 retries → 11 total attempts
      expect(chatMock).toHaveBeenCalledTimes(11);
      // ProviderBizError → 471
      expect(response.status).toBe(471);
    });

    it('should not retry local JS errors like TypeError', async () => {
      process.env.LLM_CHAT_MAX_RETRIES = '3';

      const chatMock = vi
        .fn()
        .mockRejectedValue(new TypeError('Cannot read properties of undefined'));
      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: chatMock };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(makeRequest(), { params: mockParams() });

      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(500);
    });
  });
});
