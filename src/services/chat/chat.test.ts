import { REQUEST_TOPIC_ID_HEADER, REQUEST_TRIGGER_HEADER } from '@lobechat/const';
import type { ChatStreamPayload } from '@lobechat/types';
import { ChatErrorType, RequestTrigger } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { isCanUseFC } from '@/helpers/isCanUseFC';
import { agentDocumentService } from '@/services/agentDocument';
import { oneShotRelay } from '@/services/llmRelay';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';

import * as chatHelper from './helper';
import { chatService } from './index';
import * as mechaModule from './mecha';

vi.hoisted(() => {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
});

const mockCreateHeaderWithAuth = vi.hoisted(() =>
  vi.fn(async ({ headers }: { headers: Record<string, string> }) => headers),
);

// Mocking external dependencies
vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

// 默认设置 isServerMode 为 false
vi.mock(import('@/const/version'), async (importOriginal) => ({
  ...(await importOriginal()),
  isServerMode: false,
  isDeprecatedEdition: true,
  isDesktop: false,
}));

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response(JSON.stringify({ some: 'data' })))),
);

// Mock image processing utilities
vi.mock('@lobechat/fetch-sse', async (importOriginal) => {
  const module = await importOriginal();

  return { ...(module as any), getMessageError: vi.fn() };
});
vi.mock('@lobechat/fetch-sse', async (importOriginal) => {
  const module = await importOriginal();
  return {
    ...(module as any),
    fetchSSE: vi.fn(),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  // Reset all mocks
  vi.clearAllMocks();
  // 清除所有模块的缓存
  vi.resetModules();

  // Vitest 5 keeps the module-mock factory instance across `vi.resetModules()`, so a
  // `mockReturnValue` set inside a test leaks into every later test; restore the default.
  vi.mocked(isCanUseFC).mockReturnValue(true);

  // Default mock for agentSelectors - resolveAgentConfig needs these
  vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(
    () => ({ plugins: [], systemRole: '' }) as any,
  );
  vi.spyOn(agentSelectors, 'getAgentDocumentsById').mockImplementation(
    (agentId: string) => (state) => state.agentDocumentsMap[agentId],
  );
  vi.spyOn(agentSelectors, 'getAgentSlugById').mockReturnValue(() => undefined);
  vi.spyOn(chatConfigByIdSelectors, 'getChatConfigById').mockReturnValue(
    () => ({ searchMode: 'off' }) as any,
  );
  useAgentStore.setState({ activeAgentId: undefined, agentDocumentsMap: {} } as any);
  useAiInfraStore.setState({ enabledAiModels: [] });
  useChatStore.setState({ activeAgentId: undefined } as any);
});

// mock auth
vi.mock('../_auth', () => ({
  createHeaderWithAuth: mockCreateHeaderWithAuth,
}));

// Mock isCanUseFC to control function calling behavior in tests
vi.mock('@/helpers/isCanUseFC', () => ({
  isCanUseFC: vi.fn(() => true), // Default to true, tests can override
}));

describe('ChatService', () => {
  describe('getChatCompletion', () => {
    let mockFetchSSE: any;

    beforeEach(async () => {
      // Setup common fetchSSE mock for getChatCompletion tests
      const { fetchSSE } = await import('@lobechat/fetch-sse');
      mockFetchSSE = vi.fn().mockResolvedValue(new Response('mock response'));
      vi.mocked(fetchSSE).mockImplementation(mockFetchSSE);
      mockCreateHeaderWithAuth.mockClear();
    });

    // Regression: the browser model runtime is gone. A fetchOnClient provider
    // with no relay available must still go through the server chat endpoint,
    // and the provider still reaches `run`, which only decides once a
    // late-loading (custom) provider's state is known.
    it('posts a fetchOnClient provider without relay to the server instead of a browser runtime', async () => {
      vi.spyOn(oneShotRelay, 'needsRelay').mockReturnValue(false);
      const run = vi.spyOn(oneShotRelay, 'run');
      const initializeWithClientStore = vi.spyOn(mechaModule, 'initializeWithClientStore');

      await chatService.getChatCompletion(
        { messages: [], model: 'glm-5', provider: ModelProvider.OpenCodeCodingPlan },
        { topicId: 'topic-browser' },
      );

      expect(initializeWithClientStore).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledWith(ModelProvider.OpenCodeCodingPlan, expect.any(Function), {
        signal: undefined,
      });
      const [url, options] = mockFetchSSE.mock.calls[0];
      expect(url).toBe(`/webapi/chat/${ModelProvider.OpenCodeCodingPlan}`);
      expect(options.method).toBe('POST');
      expect(options.fetcher).toBeUndefined();
      expect(options.headers).toMatchObject({ [REQUEST_TOPIC_ID_HEADER]: 'topic-browser' });
      expect(JSON.parse(options.body)).not.toHaveProperty('topicId');
    });

    // Within the LLM relay a device-only provider is called by the server and
    // relayed back to this tab: the browser must not dial it itself.
    it('sends a device-only provider through the server with the one-shot relay headers', async () => {
      vi.spyOn(chatHelper, 'isEnableFetchOnClient').mockReturnValue(true);
      vi.spyOn(oneShotRelay, 'needsRelay').mockReturnValue(true);
      const relayHeaders = {
        'x-lobe-client-id': 'tab-1',
        'x-lobe-llm-relay-channel': 'llmcall:user-1:abcdefgh',
      };
      const run = vi
        .spyOn(oneShotRelay, 'run')
        .mockImplementation(async (_provider, request) =>
          request({ channel: relayHeaders['x-lobe-llm-relay-channel'], headers: relayHeaders }),
        );
      const initializeWithClientStore = vi.spyOn(mechaModule, 'initializeWithClientStore');

      await chatService.getChatCompletion({ messages: [], model: 'qwen3', provider: 'ollama' });

      expect(run).toHaveBeenCalledWith('ollama', expect.any(Function), { signal: undefined });
      const [url, options] = mockFetchSSE.mock.calls[0];
      expect(url).toContain('/ollama');
      expect(options.fetcher).toBeUndefined();
      expect(options.headers).toMatchObject(relayHeaders);
      expect(options.requestContext).not.toHaveProperty('fetchOnClient');
      expect(initializeWithClientStore).not.toHaveBeenCalled();
    });

    // A relayed call that fails on the device streams its executor's error
    // (`{ provider, errorType, error }`). Callers read the `ChatMessageError`
    // shape the legacy browser path gave them: the Ollama provider checker
    // dereferenced `body.error` and crashed the settings page on a missing model.
    it('hands a relayed device error to the caller as a ChatMessageError', async () => {
      vi.spyOn(chatHelper, 'isEnableFetchOnClient').mockReturnValue(true);
      vi.spyOn(oneShotRelay, 'needsRelay').mockReturnValue(true);
      vi.spyOn(oneShotRelay, 'run').mockImplementation(async (_provider, request) =>
        request({ channel: 'llmcall:user-1:abcdefgh', headers: {} }),
      );
      const relayedError = {
        error: {
          message: "model 'gpt-oss:20b' not found",
          name: 'ResponseError',
          status_code: 404,
        },
        errorType: 'OllamaBizError',
        provider: 'ollama',
      };
      mockFetchSSE.mockImplementation(async (_url: string, options: any) => {
        options.onErrorHandle(relayedError);
        return new Response('');
      });
      const onErrorHandle = vi.fn();

      await chatService.getChatCompletion(
        { messages: [], model: 'gpt-oss:20b', provider: 'ollama' },
        { onErrorHandle },
      );

      expect(onErrorHandle).toHaveBeenCalledWith({
        body: relayedError,
        message: "model 'gpt-oss:20b' not found",
        type: 'OllamaBizError',
      });
    });

    // An abort while the relay channel is still being set up must not sit out
    // the subscribe timeout (manual compaction, preset-task loading state).
    it("hands the caller's abort signal to the relay setup", async () => {
      vi.spyOn(chatHelper, 'isEnableFetchOnClient').mockReturnValue(true);
      vi.spyOn(oneShotRelay, 'needsRelay').mockReturnValue(true);
      const run = vi
        .spyOn(oneShotRelay, 'run')
        .mockImplementation(async (_provider, request) => request());
      const controller = new AbortController();

      await chatService.getChatCompletion(
        { messages: [], model: 'qwen3', provider: 'ollama' },
        { signal: controller.signal },
      );

      expect(run).toHaveBeenCalledWith('ollama', expect.any(Function), {
        signal: controller.signal,
      });
    });

    it('should make a POST request with the correct payload', async () => {
      const params: Partial<ChatStreamPayload> = {
        model: 'test-model',
        messages: [],
      };
      const options = {};
      const expectedPayload = {
        model: DEFAULT_AGENT_CONFIG.model,
        stream: true,
        ...DEFAULT_AGENT_CONFIG.params,
        ...params,
        apiMode: 'responses',
      };

      await chatService.getChatCompletion(params, options);

      expect(mockFetchSSE).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(expectedPayload),
          headers: expect.any(Object),
          method: 'POST',
        }),
      );
    });

    it('should send request trigger as a header without adding it to the model payload', async () => {
      const params: Partial<ChatStreamPayload> = {
        messages: [],
        model: 'test-model',
      };

      await chatService.getChatCompletion(params, {
        metadata: { trigger: RequestTrigger.MultimodalAnalysis },
      });

      expect(mockFetchSSE).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            [REQUEST_TRIGGER_HEADER]: RequestTrigger.MultimodalAnalysis,
          }),
        }),
      );

      const payload = JSON.parse(mockFetchSSE.mock.calls[0][1].body);
      expect(payload).not.toHaveProperty('requestTrigger');
      expect(payload).not.toHaveProperty('metadata');
    });

    it('should make a POST request with chatCompletion apiMode in non-openai provider payload', async () => {
      const params: Partial<ChatStreamPayload> = {
        model: 'deepseek-reasoner',
        provider: 'deepseek',
        messages: [],
      };

      const options = {};

      const expectedPayload = {
        model: 'deepseek-reasoner',
        stream: true,
        ...DEFAULT_AGENT_CONFIG.params,
        messages: [],
        apiMode: 'chatCompletion',
        provider: undefined,
      };

      await chatService.getChatCompletion(params, options);

      expect(mockFetchSSE).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(expectedPayload),
          headers: expect.any(Object),
          method: 'POST',
        }),
      );
    });

    it('should preserve Azure Responses-only logical model and pass deploymentName separately', async () => {
      useAiInfraStore.setState({
        enabledAiModels: [
          {
            config: { deploymentName: 'prod-gpt-54' },
            id: 'gpt-5.4',
            providerId: ModelProvider.Azure,
          },
        ],
      } as any);

      const params: Partial<ChatStreamPayload> = {
        messages: [],
        model: 'gpt-5.4',
        provider: ModelProvider.Azure,
      };

      await chatService.getChatCompletion(params, {});

      const payload = JSON.parse(mockFetchSSE.mock.calls[0][1].body);

      expect(payload).toEqual(
        expect.objectContaining({
          apiMode: 'chatCompletion',
          deploymentName: 'prod-gpt-54',
          messages: [],
          model: 'gpt-5.4',
        }),
      );
    });

    it('should return InvalidAccessCode error when enableFetchOnClient is true and auth is enabled but user is not signed in', async () => {
      // Mock fetchSSE to call onErrorHandle with the error
      const { fetchSSE } = await import('@lobechat/fetch-sse');

      const mockFetchSSEWithError = vi.fn().mockImplementation((url, options) => {
        // Simulate the error being caught and passed to onErrorHandle
        if (options.onErrorHandle) {
          const error = {
            errorType: ChatErrorType.InvalidAccessCode,
            error: new Error('InvalidAccessCode'),
          };
          options.onErrorHandle(error, { errorType: ChatErrorType.InvalidAccessCode });
        }
        return Promise.resolve(new Response(''));
      });

      vi.mocked(fetchSSE).mockImplementation(mockFetchSSEWithError);

      const params: Partial<ChatStreamPayload> = {
        model: 'test-model',
        messages: [],
        provider: 'openai',
      };

      let errorHandled = false;
      const onErrorHandle = vi.fn((error: any) => {
        errorHandled = true;
        expect(error.errorType).toBe(ChatErrorType.InvalidAccessCode);
      });

      // Call getChatCompletion with onErrorHandle to catch the error
      await chatService.getChatCompletion(params, { onErrorHandle });

      // Verify that the error was handled
      expect(errorHandled).toBe(true);
      expect(onErrorHandle).toHaveBeenCalled();
    });

    // Add more test cases to cover different scenarios and edge cases
  });

  describe('fetchPresetTaskResult', () => {
    it('should forward the preset task trigger as request metadata', async () => {
      const getChatCompletionSpy = vi
        .spyOn(chatService, 'getChatCompletion')
        .mockResolvedValue(new Response(''));

      await chatService.fetchPresetTaskResult({
        params: {
          messages: [{ content: 'Hello', role: 'user' as const }],
          model: 'gpt-4',
          provider: 'openai',
        },
        trigger: RequestTrigger.TopicTitle,
      });

      expect(getChatCompletionSpy.mock.calls[0][1]?.metadata).toEqual({
        trigger: RequestTrigger.TopicTitle,
      });
    });

    it('should not wait for agent documents on preset task chains', async () => {
      vi.spyOn(chatService, 'getChatCompletion').mockResolvedValue(new Response(''));
      vi.spyOn(agentDocumentService, 'getContextDocuments').mockResolvedValue([]);

      await chatService.fetchPresetTaskResult({
        abortController: new AbortController(),
        params: {
          messages: [{ content: 'Hello', role: 'user' as const }],
          model: 'gpt-4',
          provider: 'openai',
        },
        trigger: RequestTrigger.Translate,
      });

      expect(agentDocumentService.getContextDocuments).not.toHaveBeenCalled();
    });

    it('should handle successful chat completion response', async () => {
      // Mock getChatCompletion to simulate successful completion
      vi.spyOn(chatService, 'getChatCompletion').mockImplementation(async (params, options) => {
        // Simulate successful response
        if (options?.onFinish) {
          options.onFinish('AI response', {
            type: 'done',
            observationId: null,
            toolCalls: undefined,
            traceId: null,
          });
        }
        if (options?.onMessageHandle) {
          options.onMessageHandle({ type: 'text', text: 'AI response' });
        }
        return new Response('');
      });

      const params = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4',
        provider: 'openai',
      };

      const onMessageHandle = vi.fn();
      const onFinish = vi.fn();
      const onError = vi.fn();
      const onLoadingChange = vi.fn();
      const abortController = new AbortController();
      const trace = {};

      await chatService.fetchPresetTaskResult({
        params,
        onMessageHandle,
        onFinish,
        onError,
        onLoadingChange,
        abortController,
        trace,
        trigger: RequestTrigger.Translate,
      });

      expect(onFinish).toHaveBeenCalledWith('AI response', {
        type: 'done',
        observationId: null,
        toolCalls: undefined,
        traceId: null,
      });
      expect(onError).not.toHaveBeenCalled();
      expect(onMessageHandle).toHaveBeenCalled();
      expect(onLoadingChange).toHaveBeenCalledWith(false); // Confirm loading state is set to false
      expect(onLoadingChange).toHaveBeenCalledTimes(2);
    });

    it('should handle error in chat completion', async () => {
      // Mock getChatCompletion to simulate error
      vi.spyOn(chatService, 'getChatCompletion').mockImplementation(async (params, options) => {
        // Simulate error response
        if (options?.onErrorHandle) {
          options.onErrorHandle({ message: 'translated_response.404', type: 404 });
        }
        return new Response('');
      });

      const params = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4',
        provider: 'openai',
      };
      const onError = vi.fn();
      const onLoadingChange = vi.fn();
      const abortController = new AbortController();
      const trace = {};

      await chatService.fetchPresetTaskResult({
        params,
        onError,
        onLoadingChange,
        abortController,
        trace,
        trigger: RequestTrigger.Translate,
      });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), {
        message: 'translated_response.404',
        type: 404,
      });
      expect(onLoadingChange).toHaveBeenCalledWith(false); // Confirm loading state is set to false
    });
  });
});

/**
 * Tests for ModelRuntime on client side, aim to test the
 * initialization of ModelRuntime with different providers
 */
vi.mock('../_auth', async (importOriginal) => {
  return importOriginal();
});

describe('ChatService private methods', () => {
  describe('getChatCompletion', () => {
    it('should merge responseAnimation styles correctly', async () => {
      const { fetchSSE } = await import('@lobechat/fetch-sse');

      // Mock provider config
      const { aiProviderSelectors } = await import('@/store/aiInfra');
      vi.spyOn(aiProviderSelectors, 'providerConfigById').mockReturnValue({
        id: 'openai',
        settings: {
          responseAnimation: 'slow',
        },
      } as any);

      // Mock user preference
      const { userGeneralSettingsSelectors } = await import('@/store/user/selectors');
      vi.spyOn(userGeneralSettingsSelectors, 'transitionMode').mockReturnValue('smooth');

      await chatService.getChatCompletion(
        { provider: 'openai', messages: [] },
        { responseAnimation: { speed: 20 } },
      );

      expect(fetchSSE).toHaveBeenCalled();
      const fetchSSEOptions = (fetchSSE as any).mock.calls[0][1];

      expect(fetchSSEOptions.responseAnimation).toEqual({
        speed: 20,
        text: 'fadeIn',
      });
    });
  });
});
