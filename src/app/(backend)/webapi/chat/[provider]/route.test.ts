// @vitest-environment node
import { REQUEST_TOPIC_ID_HEADER } from '@lobechat/const';
import { type LobeRuntimeAI } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { POST } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
  createTraceOptions: vi.fn().mockReturnValue({}),
}));

const resolveProviderRelay = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite', () => ({
  resolveProviderRelay,
}));
// A deployment that can relay (Agent Gateway + Redis); one that cannot keeps
// calling the provider from the server.
vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => ({}) }));
vi.mock('@/server/modules/AgentRuntime/factory', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createStreamEventManager: () => ({ openLlmRelayChannel: vi.fn(), sendLlmExecute: vi.fn() }),
}));

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
    method: 'POST',
    body: JSON.stringify({ model: 'test-model' }),
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  resolveProviderRelay.mockResolvedValue(undefined);
});

describe('POST handler', () => {
  describe('one-shot relay', () => {
    // A provider only the user's device reaches (Ollama, LM Studio, a private
    // base URL) is never dialed from the server: without a tab standing by to
    // run it, the route answers with an explicit error instead.
    it('answers ClientLlmExecutorUnavailable for a device-only provider with no tab attached', async () => {
      resolveProviderRelay.mockResolvedValue({ runtimeProvider: 'ollama' });

      const response = await POST(request, { params: Promise.resolve({ provider: 'ollama' }) });

      expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({
        body: {
          error: { context: 'no_client_request', reason: 'no_executor' },
          provider: 'ollama',
        },
        errorType: 'ClientLlmExecutorUnavailable',
      });
    });
  });

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
    it.each([undefined, 'topic-123'])(
      'should pass topic %s to chat runtime metadata',
      async (topicId) => {
        const mockParams = Promise.resolve({ provider: 'test-provider' });
        const mockChatPayload = { message: 'Hello, world!' };
        request = new Request(new URL('https://test.com'), {
          method: 'POST',
          headers: topicId ? { [REQUEST_TOPIC_ID_HEADER]: topicId } : {},
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
          metadata: { topicId },
          user: 'test-user-id',
          signal: expect.anything(),
        });
      },
    );

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
