// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as modelParse from '../../utils/modelParse';
import { LobeProxyStacksAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

type RouterForTest = {
  apiType: string;
  models?: string[];
  options: {
    baseURL?: string;
    chatCompletion?: { useResponseModels?: Array<string | RegExp> };
    sdkType?: string;
  };
};

const resolveRouters = (baseURL?: string, model?: string) =>
  params.routers({ apiKey: 'test', baseURL }, { model }) as RouterForTest[];

describe('LobeProxyStacksAI', () => {
  let instance: InstanceType<typeof LobeProxyStacksAI>;

  beforeEach(() => {
    loadModelsMock.mockResolvedValue([]);
    instance = new LobeProxyStacksAI({ apiKey: 'test_api_key' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize router runtime instance', () => {
      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(LobeProxyStacksAI);
    });
  });

  describe('routers', () => {
    it('should route Anthropic family models including newly discovered Claude IDs to anthropic runtime', () => {
      const routers = resolveRouters(undefined, 'claude-sonnet-4-6-custom');
      const anthropicRouter = routers.find((router) => router.apiType === 'anthropic');

      expect(anthropicRouter?.models).toContain('claude-sonnet-4-6-custom');
      expect(anthropicRouter?.options.baseURL).toBe('https://proxystacks.com');
    });

    it('should route DeepSeek family models including gateway-specific IDs to deepseek runtime', () => {
      const routers = resolveRouters(undefined, 'deepseek-v4.1-flash');
      const deepseekRouter = routers.find((router) => router.apiType === 'deepseek');

      expect(deepseekRouter?.models).toContain('deepseek-v4.1-flash');
      expect(deepseekRouter?.options.baseURL).toBe('https://proxystacks.com/v1');
      expect(deepseekRouter?.options.chatCompletion?.useResponseModels?.length).toBeGreaterThan(0);
      expect(deepseekRouter?.options.sdkType).toBe('openai');
    });

    it('should normalize default and custom regional baseURLs without doubling /v1', () => {
      const defaultRouters = resolveRouters();
      expect(defaultRouters.find((r) => r.apiType === 'anthropic')?.options.baseURL).toBe(
        'https://proxystacks.com',
      );
      expect(defaultRouters.at(-1)?.options.baseURL).toBe('https://proxystacks.com/v1');

      const hkVersioned = resolveRouters('https://hk.proxystacks.com/v1');
      expect(hkVersioned.find((r) => r.apiType === 'anthropic')?.options.baseURL).toBe(
        'https://hk.proxystacks.com',
      );
      expect(hkVersioned.at(-1)?.options.baseURL).toBe('https://hk.proxystacks.com/v1');

      const hkRoot = resolveRouters('https://hk.proxystacks.com');
      expect(hkRoot.find((r) => r.apiType === 'anthropic')?.options.baseURL).toBe(
        'https://hk.proxystacks.com',
      );
      expect(hkRoot.at(-1)?.options.baseURL).toBe('https://hk.proxystacks.com/v1');
    });

    it('should keep OpenAI catch-all router with Responses API model matchers last', () => {
      const catchAll = resolveRouters().at(-1);
      expect(catchAll?.apiType).toBe('openai');
      expect(catchAll?.models).toBeUndefined();
      expect(catchAll?.options.chatCompletion?.useResponseModels?.length).toBeGreaterThan(0);
    });
  });

  describe('models', () => {
    it('should list models from OpenAI-compatible client and delegate merged cards to processMultiProviderModelList', async () => {
      const spy = vi
        .spyOn(modelParse, 'processMultiProviderModelList')
        .mockResolvedValueOnce([{ id: 'deepseek-v4.1-flash' }] as any);

      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValueOnce({
            data: [{ id: 'deepseek-v4.1-flash', object: 'model', owned_by: 'deepseek' }],
          }),
        },
      };

      const result = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            contextWindowTokens: 1_048_576,
            displayName: 'DeepSeek V4.1 Flash',
            enabled: true,
            id: 'deepseek-v4.1-flash',
          }),
        ],
        'proxystacks',
      );
      expect(result).toEqual([{ id: 'deepseek-v4.1-flash' }]);
    });

    it('should prefer ProxyStacks local card metadata over upstream owner defaults on ID-only payloads', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValueOnce({
            data: [
              { id: 'glm-5.3', object: 'model', owned_by: 'zhipu' },
              { id: 'claude-sonnet-4-6-custom', object: 'model', owned_by: 'anthropic' },
            ],
          }),
        },
      };

      const result = await params.models({ client: mockClient as any });
      const glm = result.find((m) => m.id === 'glm-5.3');
      const unbundledClaude = result.find((m) => m.id === 'claude-sonnet-4-6-custom');

      expect(glm).toMatchObject({
        contextWindowTokens: 1_000_000,
        displayName: 'GLM-5.3',
        enabled: true,
        functionCall: true,
        id: 'glm-5.3',
        maxOutput: 131_072,
        reasoning: true,
        search: false,
        vision: false,
      });
      expect(glm?.pricing?.units).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'textInput', rate: 0.98 })]),
      );
      expect(unbundledClaude).toMatchObject({
        enabled: false,
        functionCall: true,
        id: 'claude-sonnet-4-6-custom',
        vision: true,
      });
    });
  });

  describe('chat', () => {
    it('should keep DeepSeek V4 chats on Chat Completions with reasoning_content when provider-wide Responses API is enabled', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4.1-flash","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          {
            headers: { 'content-type': 'text/event-stream' },
            status: 200,
          },
        ),
      );

      const runtime = new LobeProxyStacksAI({
        apiKey: 'test_api_key',
        fetch: fetchMock as any,
      });

      const response = await runtime.chat({
        apiMode: 'responses',
        messages: [
          { content: 'Run tool', role: 'user' },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: { arguments: '{}', name: 'lookup' },
                id: 'call_1',
                type: 'function',
              },
            ],
          } as any,
          { content: '{"ok":true}', role: 'tool', tool_call_id: 'call_1' } as any,
        ],
        model: 'deepseek-v4.1-flash',
        stream: true,
      });

      await response.text();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [requestUrl, requestInit] = fetchMock.mock.calls[0];
      expect(String(requestUrl)).toBe('https://proxystacks.com/v1/chat/completions');

      const sentBody = JSON.parse(String(requestInit.body));
      expect(sentBody.apiMode).toBeUndefined();
      expect(sentBody.messages[1].reasoning_content).toBe('');
    });

    it('should preserve Responses API routing for matching OpenAI GPT models when enabled', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","object":"response","model":"gpt-5.4","output":[],"status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
          {
            headers: { 'content-type': 'text/event-stream' },
            status: 200,
          },
        ),
      );

      const runtime = new LobeProxyStacksAI({
        apiKey: 'test_api_key',
        fetch: fetchMock as any,
      });

      const response = await runtime.chat({
        apiMode: 'responses',
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-5.4',
        stream: true,
      });

      await response.text();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [requestUrl] = fetchMock.mock.calls[0];
      expect(String(requestUrl)).toBe('https://proxystacks.com/v1/responses');
    });
  });
});
