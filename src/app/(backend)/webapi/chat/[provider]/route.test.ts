// @vitest-environment node
import { type LobeRuntimeAI } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_CHAT_AUTH_HEADER, OAUTH_AUTHORIZED } from '@/envs/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { POST } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
  createTraceOptions: vi.fn().mockReturnValue({}),
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

// 模拟请求和响应
let request: Request;
beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    headers: {
      [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token',
      [OAUTH_AUTHORIZED]: 'true',
    },
    method: 'POST',
    body: JSON.stringify({ model: 'test-model' }),
  });
});

afterEach(() => {
  // 清除模拟调用历史
  vi.clearAllMocks();
});

describe('POST handler', () => {
  describe('init chat model', () => {
    it('should initialize ModelRuntime correctly with valid authorization', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });

      // 设置 getJWTPayload 的模拟返回值
      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
        azureApiVersion: 'v1',
      });

      // chat mock 需要返回一个 Response 对象，否则中间件访问 res.headers 会报错
      const mockChatResponse = new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };

      // Mock initModelRuntimeFromDB
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      // 调用 POST 函数
      await POST(request as unknown as Request, { params: mockParams });

      // 验证是否正确调用了模拟函数
      expect(getXorPayload).toHaveBeenCalledWith('Bearer some-valid-token');
      expect(initModelRuntimeFromDB).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        'test-provider',
      );
    });

    it('should return Unauthorized error when LOBE_CHAT_AUTH_HEADER is missing', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const requestWithoutAuthHeader = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify({ model: 'test-model' }),
      });

      const response = await POST(requestWithoutAuthHeader, { params: mockParams });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        body: {
          error: { errorType: 401 },
          provider: 'test-provider',
        },
        errorType: 401,
      });
    });

    it('should return InternalServerError error when throw a unknown error', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      vi.mocked(getXorPayload).mockImplementationOnce(() => {
        throw new Error('unknown error');
      });

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        body: {
          error: {},
          provider: 'test-provider',
        },
        errorType: 500,
      });
    });
  });

  describe('chat', () => {
    it('should correctly handle chat completion with valid payload', async () => {
      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
        azureApiVersion: 'v1',
        userId: 'abc',
      });

      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
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
        user: expect.any(String),
        signal: expect.anything(),
      });
    });

    it('should return an error response when chat completion fails', async () => {
      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
        azureApiVersion: 'v1',
      });

      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
        method: 'POST',
        body: JSON.stringify(mockChatPayload),
      });

      const mockErrorResponse = {
        errorType: ChatErrorType.InternalServerError,
        error: { errorMessage: 'Something went wrong', errorType: 500 },
        errorMessage: 'Something went wrong',
      };

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
});
