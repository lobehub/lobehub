// @vitest-environment node
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import {
  getProviderDisplayIdentifier,
  REQUEST_TOPIC_ID_HEADER,
  REQUEST_TRIGGER_HEADER,
} from '@lobechat/const';
import { type LobeRuntimeAI } from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { POST } from './route';

const mockIsLobeHubModelAvailable = vi.hoisted(() => vi.fn());
// Better Auth changes the result shape when returnHeaders is true.
const mockGetSession = vi.hoisted(() =>
  vi.fn<
    () => Promise<{ response: { session: object; user: { id: string } } | null; headers: Headers }>
  >(),
);

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
      getSession: mockGetSession,
    },
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: vi.fn() },
}));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  isLobeHubModelAvailable: mockIsLobeHubModelAvailable,
}));

// 模拟请求和响应
let request: Request;
beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    method: 'POST',
    body: JSON.stringify({ model: 'test-model' }),
  });

  // Default: valid session
  mockGetSession.mockResolvedValue({
    response: { session: {} as any, user: { id: 'test-user-id' } as any },
    headers: new Headers(),
  });

  mockIsLobeHubModelAvailable.mockResolvedValue(true);
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
      mockGetSession.mockResolvedValue({ response: null, headers: new Headers() });

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
          metadata: {
            provider: 'test-provider',
            sessionId: undefined,
            topicId,
            trigger: 'chat',
          },
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

    it('should reject a beta-gated LobeHub model the user is not authorized for', async () => {
      const mockParams = Promise.resolve({ provider: BRANDING_PROVIDER });
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify({ model: 'beta-model' }),
      });

      vi.mocked(UserModel.findById).mockResolvedValue({ email: 'user@example.com' } as any);
      mockIsLobeHubModelAvailable.mockResolvedValue(false);

      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: vi.fn() };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request as unknown as Request, { params: mockParams });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        body: {
          error: { modelType: 'chat', requestedModel: 'beta-model' },
          provider: getProviderDisplayIdentifier(BRANDING_PROVIDER),
        },
        errorType: ChatErrorType.LobeHubModelDeprecated,
      });
      expect(mockRuntime.chat).not.toHaveBeenCalled();
      expect(mockIsLobeHubModelAvailable).toHaveBeenCalledWith('beta-model', 'chat', {
        getUserEmail: expect.any(Function),
        trigger: undefined,
        userId: 'test-user-id',
      });
    });

    it('forwards the request trigger header to the access check', async () => {
      const mockParams = Promise.resolve({ provider: BRANDING_PROVIDER });
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({ model: 'system-model' }),
        headers: { [REQUEST_TRIGGER_HEADER]: 'translate' },
        method: 'POST',
      });

      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue({ success: true }),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      await POST(request as unknown as Request, { params: mockParams });

      expect(mockIsLobeHubModelAvailable).toHaveBeenCalledWith('system-model', 'chat', {
        getUserEmail: expect.any(Function),
        trigger: 'translate',
        userId: 'test-user-id',
      });
    });

    it.each([
      { header: 'topic_title', metadataTrigger: 'topic_title', accessTrigger: 'topic_title' },
      { header: undefined, metadataTrigger: 'chat', accessTrigger: undefined },
      { header: 'not-a-real-trigger', metadataTrigger: 'chat', accessTrigger: undefined },
    ])(
      'resolves trigger from header $header to metadata $metadataTrigger',
      async ({ header, metadataTrigger, accessTrigger }) => {
        const mockParams = Promise.resolve({ provider: BRANDING_PROVIDER });
        const payload = { model: 'system-model' };
        request = new Request(new URL('https://test.com'), {
          body: JSON.stringify(payload),
          headers: header ? { [REQUEST_TRIGGER_HEADER]: header } : {},
          method: 'POST',
        });

        const mockRuntime: LobeRuntimeAI = {
          baseURL: 'abc',
          chat: vi.fn().mockResolvedValue({ success: true }),
        };
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

        await POST(request as unknown as Request, { params: mockParams });

        // The route-level gate sees only a known enum value …
        expect(mockIsLobeHubModelAvailable).toHaveBeenCalledWith('system-model', 'chat', {
          getUserEmail: expect.any(Function),
          trigger: accessTrigger,
          userId: 'test-user-id',
        });
        // … and beforeChat receives the same trigger, so an auxiliary call the
        // route gate allowed is not re-rejected as a plain `chat`.
        expect(mockRuntime.chat).toHaveBeenCalledWith(
          payload,
          expect.objectContaining({
            metadata: expect.objectContaining({ trigger: metadataTrigger }),
          }),
        );
      },
    );

    it('should not gate models for a provider other than the branded one', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      request = new Request(new URL('https://test.com'), {
        method: 'POST',
        body: JSON.stringify({ model: 'some-model' }),
      });

      const mockChatResponse: any = { success: true };
      const mockRuntime: LobeRuntimeAI = {
        baseURL: 'abc',
        chat: vi.fn().mockResolvedValue(mockChatResponse),
      };
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(new ModelRuntime(mockRuntime));

      const response = await POST(request as unknown as Request, { params: mockParams });

      expect(response).toEqual(mockChatResponse);
      expect(mockIsLobeHubModelAvailable).not.toHaveBeenCalled();
    });
  });
});
