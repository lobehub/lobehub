// @vitest-environment node
import type { ChatModelCard } from '@lobechat/types';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LobeDeepSeekAI,
  LobeDeepSeekAnthropicAI,
  LobeDeepSeekOpenAI,
  openAIParams,
  params,
} from './index';

const defaultOpenAIBaseURL = 'https://api.deepseek.com/v1';
const anthropicBaseURL = 'https://api.deepseek.com/anthropic';

vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeDeepSeekAI', () => {
  const createRuntime = ({
    baseURL,
    sdkType,
  }: {
    baseURL?: string;
    sdkType?: string;
  } = {}) =>
    new LobeDeepSeekAI({
      apiKey: 'test',
      ...(baseURL ? { baseURL } : {}),
      ...(sdkType ? { sdkType } : {}),
    });

  const resolveRouter = async (baseURL?: string, sdkType?: string) => {
    const runtime = createRuntime({ baseURL, sdkType });

    return (runtime as any).resolveMatchedRouter('deepseek-v4-pro');
  };

  const resolveFirstRouterOption = async (baseURL: string, sdkType: string) => {
    const runtime = createRuntime({ baseURL, sdkType });
    const router = await (runtime as any).resolveMatchedRouter('deepseek-v4-pro');
    const routerOptions = (runtime as any).normalizeRouterOptions(router);

    return {
      option: routerOptions[0],
      router,
    };
  };

  describe('RouterRuntime baseURL routing', () => {
    it('should route to Anthropic format by default', async () => {
      const router = await resolveRouter();

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('anthropic-compatible');
    });

    it('should route to Anthropic format when baseURL ends with /anthropic', async () => {
      const router = await resolveRouter(anthropicBaseURL);

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('anthropic-compatible');
    });

    it('should route to Anthropic format when baseURL ends with /anthropic/', async () => {
      const router = await resolveRouter(`${anthropicBaseURL}/`);

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('anthropic-compatible');
    });

    it('should route to OpenAI format when baseURL ends with /v1', async () => {
      const router = await resolveRouter(defaultOpenAIBaseURL);

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('openai-compatible');
    });

    it('should route custom non-Anthropic baseURL to OpenAI format', async () => {
      const router = await resolveRouter('https://api.deepseek.com');

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('openai-compatible');
    });

    it('should route to Anthropic format when sdkType is anthropic', async () => {
      const router = await resolveRouter('https://aihubmix.com/v1/messages', 'anthropic');

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('anthropic-compatible');
    });

    it('should normalize /v1/messages before creating an Anthropic SDK runtime', async () => {
      const { option } = await resolveFirstRouterOption(
        'https://aihubmix.com/v1/messages',
        'anthropic',
      );
      const runtime = new LobeDeepSeekAnthropicAI({ apiKey: 'test', baseURL: option.baseURL });

      expect(option.baseURL).toBe('https://aihubmix.com');
      expect(runtime).toBeInstanceOf(LobeDeepSeekAnthropicAI);
      expect((runtime as any).baseURL).toBe('https://aihubmix.com');
    });

    it('should normalize /anthropic/v1/messages before creating an Anthropic SDK runtime', async () => {
      const { option } = await resolveFirstRouterOption(
        'https://api.deepseek.com/anthropic/v1/messages',
        'anthropic',
      );
      const runtime = new LobeDeepSeekAnthropicAI({ apiKey: 'test', baseURL: option.baseURL });

      expect(option.baseURL).toBe(anthropicBaseURL);
      expect(runtime).toBeInstanceOf(LobeDeepSeekAnthropicAI);
      expect((runtime as any).baseURL).toBe(anthropicBaseURL);
    });

    it('should let sdkType override legacy baseURL suffix routing', async () => {
      const router = await resolveRouter(anthropicBaseURL, 'openai');

      expect(router.apiType).toBe('deepseek');
      expect(router.id).toBe('openai-compatible');
    });

    it('should reject unsupported sdkType values', async () => {
      await expect(resolveRouter(defaultOpenAIBaseURL, 'invalid')).rejects.toThrow(
        'Unsupported DeepSeek sdkType: invalid',
      );
    });
  });
});

describe('LobeDeepSeekOpenAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const runtime = new LobeDeepSeekOpenAI({ apiKey: 'test_api_key' });

      expect(runtime).toBeInstanceOf(LobeDeepSeekOpenAI);
      expect((runtime as any).baseURL).toEqual(defaultOpenAIBaseURL);
    });
  });
});

describe('LobeDeepSeekAnthropicAI', () => {
  let instance: InstanceType<typeof LobeDeepSeekAnthropicAI>;

  const getLastRequestPayload = () => {
    const calls = ((instance as any).client.messages.create as Mock).mock.calls;
    return calls.at(-1)?.[0];
  };

  beforeEach(() => {
    instance = new LobeDeepSeekAnthropicAI({ apiKey: 'test' });

    vi.spyOn((instance as any).client.messages, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const runtime = new LobeDeepSeekAnthropicAI({ apiKey: 'test_api_key' });

      expect(runtime).toBeInstanceOf(LobeDeepSeekAnthropicAI);
      expect((runtime as any).baseURL).toEqual(anthropicBaseURL);
    });
  });

  describe('handlePayload', () => {
    it('should enable thinking by default for deepseek-v4-pro', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro',
        temperature: 0,
      });

      const payload = getLastRequestPayload();

      expect(payload.max_tokens).toBe(384_000);
      expect(payload.thinking).toEqual({
        budget_tokens: 1024,
        type: 'enabled',
      });
    });

    it('should disable thinking when thinking.type is disabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-flash',
        reasoning_effort: 'high',
        thinking: { budget_tokens: 0, type: 'disabled' },
      });

      const payload = getLastRequestPayload();

      expect(payload.thinking).toEqual({ type: 'disabled' });
      expect(payload.output_config).toBeUndefined();
    });

    it('should map reasoning_effort to output_config.effort when thinking is enabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-flash',
        reasoning_effort: 'high',
        thinking: { budget_tokens: 2048, type: 'enabled' },
      });

      const payload = getLastRequestPayload();

      expect(payload.output_config).toEqual({ effort: 'high' });
      expect(payload.thinking).toEqual({
        budget_tokens: 2048,
        type: 'enabled',
      });
    });

    it('should not add thinking params for deepseek-chat by default', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-chat',
      });

      const payload = getLastRequestPayload();

      expect(payload.thinking).toBeUndefined();
      expect(payload.output_config).toBeUndefined();
    });

    it('should preserve DeepSeek temperature scale for non-thinking Anthropic requests', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-chat',
        temperature: 1.4,
      });

      const payload = getLastRequestPayload();

      expect(payload.temperature).toBe(1.4);
    });

    it('should convert assistant reasoning to Anthropic thinking block', async () => {
      await instance.chat({
        messages: [
          { content: 'Hello', role: 'user' },
          {
            content: 'Response',
            reasoning: { content: 'My reasoning process' },
            role: 'assistant',
          } as any,
          { content: 'Follow-up', role: 'user' },
        ],
        model: 'deepseek-v4-flash',
      });

      const payload = getLastRequestPayload();
      const assistantMessage = payload.messages.find(
        (message: any) => message.role === 'assistant',
      );

      expect(assistantMessage?.content).toEqual([
        { thinking: 'My reasoning process', type: 'thinking' },
        { text: 'Response', type: 'text' },
      ]);
    });

    it('should convert tool calls to Anthropic tool_use with a thinking placeholder', async () => {
      await instance.chat({
        messages: [
          { content: 'Search weather', role: 'user' },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: { arguments: '{"city":"Beijing"}', name: 'get_weather' },
                id: 'call_1',
                type: 'function',
              },
            ],
          } as any,
          {
            content: '{"temp":20}',
            role: 'tool',
            tool_call_id: 'call_1',
          } as any,
        ],
        model: 'deepseek-v4-flash',
      });

      const payload = getLastRequestPayload();
      const assistantMessage = payload.messages.find(
        (message: any) => message.role === 'assistant',
      );

      expect(assistantMessage?.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ thinking: ' ', type: 'thinking' }),
          expect.objectContaining({ name: 'get_weather', type: 'tool_use' }),
        ]),
      );
    });
  });
});

describe('LobeDeepSeekAI - custom features', () => {
  describe('chatCompletion.handlePayload', () => {
    it('should transform reasoning object to reasoning_content string', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: 'Hi there',
            reasoning: { content: 'Let me think...', duration: 1000 },
          },
          { role: 'user', content: 'How are you?' },
        ],
        model: 'deepseek-r1',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'Hi there',
          reasoning_content: 'Let me think...',
        },
        { role: 'user', content: 'How are you?' },
      ]);
    });

    it('should not modify messages without reasoning field', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
        model: 'deepseek-chat',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual(payload.messages);
    });

    it('should handle empty reasoning content', () => {
      const payload = {
        messages: [
          {
            role: 'assistant',
            content: 'Response',
            reasoning: { duration: 1000 },
          },
        ],
        model: 'deepseek-r1',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0]).toEqual({
        role: 'assistant',
        content: 'Response',
      });
    });

    it('should set stream to true by default', () => {
      const payload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'deepseek-chat',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.stream).toBe(true);
    });

    it('should preserve existing stream value', () => {
      const payload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'deepseek-chat',
        stream: false,
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.stream).toBe(false);
    });

    it('should add empty reasoning_content for assistant messages in deepseek-reasoner', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Search weather' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'search',
                  arguments: '{"q":"weather"}',
                },
              },
            ],
          },
          { role: 'tool', content: '{"result":"sunny"}', tool_call_id: 'call_1' },
        ],
        model: 'deepseek-reasoner',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        { role: 'user', content: 'Search weather' },
        {
          role: 'assistant',
          content: '',
          reasoning_content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search',
                arguments: '{"q":"weather"}',
              },
            },
          ],
        },
        { role: 'tool', content: '{"result":"sunny"}', tool_call_id: 'call_1' },
      ]);
    });

    it('should preserve existing reasoning_content for deepseek-reasoner assistant messages', () => {
      const payload = {
        messages: [
          {
            role: 'assistant',
            content: 'Previous answer',
            reasoning_content: 'existing reasoning',
          },
        ],
        model: 'deepseek-reasoner',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        {
          role: 'assistant',
          content: 'Previous answer',
          reasoning_content: 'existing reasoning',
        },
      ]);
    });

    // DeepSeek V4 models default to thinking mode unless thinking.type === 'disabled'.
    // In thinking mode the API rejects follow-up turns whose assistant messages omit
    // reasoning_content when tool calls are involved — see index.ts for details.
    describe('deepseek-v4 thinking mode reasoning_content enforcement', () => {
      it('should force reasoning_content on v4-flash assistant messages by default', () => {
        const payload = {
          messages: [
            { role: 'user', content: 'Search weather' },
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'search', arguments: '{"q":"weather"}' },
                },
              ],
            },
          ],
          model: 'deepseek-v4-flash',
        };

        const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

        expect(result.messages[1]).toEqual({
          role: 'assistant',
          content: '',
          reasoning_content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"weather"}' },
            },
          ],
        });
      });

      it('should force reasoning_content on v4-pro assistant messages by default', () => {
        const payload = {
          messages: [{ role: 'assistant', content: 'hi' }],
          model: 'deepseek-v4-pro',
        };

        const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

        expect(result.messages[0]).toEqual({
          role: 'assistant',
          content: 'hi',
          reasoning_content: '',
        });
      });

      it('should force reasoning_content when thinking.type is explicitly enabled', () => {
        const payload = {
          messages: [{ role: 'assistant', content: 'hi' }],
          model: 'deepseek-v4-flash',
          thinking: { type: 'enabled' },
        };

        const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

        expect(result.messages[0]).toEqual({
          role: 'assistant',
          content: 'hi',
          reasoning_content: '',
        });
      });

      it('should NOT force reasoning_content when thinking.type is disabled', () => {
        const payload = {
          messages: [{ role: 'assistant', content: 'hi' }],
          model: 'deepseek-v4-flash',
          thinking: { type: 'disabled' },
        };

        const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

        expect(result.messages[0]).toEqual({
          role: 'assistant',
          content: 'hi',
        });
      });

      it('should remove reasoning_effort when thinking.type is disabled', () => {
        const payload = {
          messages: [{ role: 'user', content: 'hi' }],
          model: 'deepseek-v4-flash',
          reasoning_effort: 'high',
          thinking: { type: 'disabled' },
        };

        const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

        expect(result).toEqual({
          messages: [{ role: 'user', content: 'hi' }],
          model: 'deepseek-v4-flash',
          stream: true,
          thinking: { type: 'disabled' },
        });
      });

      it('should preserve reasoning_effort when thinking is enabled', () => {
        const payload = {
          messages: [{ role: 'user', content: 'hi' }],
          model: 'deepseek-v4-flash',
          reasoning_effort: 'high',
          thinking: { type: 'enabled' },
        };

        const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

        expect(result.reasoning_effort).toBe('high');
      });

      it('should preserve existing reasoning_content on v4 assistant messages', () => {
        const payload = {
          messages: [
            {
              role: 'assistant',
              content: 'answer',
              reasoning_content: 'prior reasoning',
            },
          ],
          model: 'deepseek-v4-flash',
        };

        const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

        expect(result.messages[0]).toEqual({
          role: 'assistant',
          content: 'answer',
          reasoning_content: 'prior reasoning',
        });
      });

      it('should NOT force reasoning_content on non-v4 / non-reasoner models', () => {
        const payload = {
          messages: [{ role: 'assistant', content: 'hi' }],
          model: 'deepseek-chat',
        };

        const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

        expect(result.messages[0]).toEqual({
          role: 'assistant',
          content: 'hi',
        });
      });
    });
  });

  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION;
      const result = openAIParams.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION = '1';
      const result = openAIParams.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_DEEPSEEK_CHAT_COMPLETION;
    });
  });

  describe('generateObject configuration', () => {
    it('should use tools calling for generateObject', () => {
      expect(openAIParams.generateObject).toBeDefined();
      expect(openAIParams.generateObject?.useToolsCalling).toBe(true);
    });
  });

  describe('models', () => {
    const fetchModels = params.models as (params: { client: unknown }) => Promise<ChatModelCard[]>;
    const mockClient = {
      models: {
        list: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch and process models successfully', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'deepseek-chat' }, { id: 'deepseek-coder' }, { id: 'deepseek-r1' }],
      });

      const models = await fetchModels({ client: mockClient });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('deepseek-chat');
      expect(models[1].id).toBe('deepseek-coder');
      expect(models[2].id).toBe('deepseek-r1');
    });

    it('should handle single model', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'deepseek-chat' }],
      });

      const models = await fetchModels({ client: mockClient });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('deepseek-chat');
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await fetchModels({ client: mockClient });

      expect(models).toEqual([]);
    });

    it('should process models with MODEL_LIST_CONFIGS', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'deepseek-chat' }],
      });

      const models = await fetchModels({ client: mockClient });

      // The processModelList function should merge with known model list
      expect(models[0]).toHaveProperty('id');
      expect(models[0].id).toBe('deepseek-chat');
    });

    it('should preserve model properties from API response', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'deepseek-chat', extra_field: 'value' },
          { id: 'deepseek-coder', another_field: 123 },
        ],
      });

      const models = await fetchModels({ client: mockClient });

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('deepseek-chat');
      expect(models[1].id).toBe('deepseek-coder');
    });

    it('should handle models with different id patterns', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'deepseek-chat' },
          { id: 'deepseek-r1' },
          { id: 'deepseek-reasoner' },
          { id: 'deepseek-v3' },
        ],
      });

      const models = await fetchModels({ client: mockClient });

      expect(models).toHaveLength(4);
      expect(models.every((m) => typeof m.id === 'string')).toBe(true);
    });
  });
});
