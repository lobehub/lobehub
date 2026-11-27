// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeAPIStoreAI, params } from './index';

const provider = ModelProvider.APIStore;
const defaultBaseURL = 'https://api.apistore.cloud/v1';

testProvider({
  Runtime: LobeAPIStoreAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_APISTORE_CHAT_COMPLETION',
  chatModel: 'claude-haiku-4-5',
  test: {
    skipAPICall: true,
  },
});

describe('LobeAPIStoreAI - custom features', () => {
  describe('chatCompletion.handlePayload', () => {
    const handlePayload = params.chatCompletion.handlePayload;

    it('streams by default and keeps an explicit stream value', () => {
      expect(handlePayload({ messages: [], model: 'claude-sonnet-5-5' } as any).stream).toBe(true);
      expect(
        handlePayload({ messages: [], model: 'claude-sonnet-5-5', stream: false } as any).stream,
      ).toBe(false);
    });

    it('passes reasoning_effort through unchanged', () => {
      const result = handlePayload({
        messages: [],
        model: 'claude-opus-5-5',
        reasoning_effort: 'high',
      } as any);

      expect(result.reasoning_effort).toBe('high');
    });

    it('sends a Claude effort as reasoning_effort', () => {
      const result = handlePayload({
        effort: 'medium',
        messages: [],
        model: 'claude-opus-5-5',
      } as any) as any;

      expect(result.reasoning_effort).toBe('medium');
      expect(result.effort).toBeUndefined();
    });

    it('sends a Gemini thinking level as reasoning_effort', () => {
      const result = handlePayload({
        messages: [],
        model: 'gemini-4-argon',
        thinkingLevel: 'low',
      } as any) as any;

      expect(result.reasoning_effort).toBe('low');
      expect(result.thinkingLevel).toBeUndefined();
    });

    it('drops Anthropic thinking blocks the endpoint does not read', () => {
      const result = handlePayload({
        messages: [],
        model: 'claude-sonnet-5-5',
        thinking: { budget_tokens: 1024, type: 'enabled' },
        thinkingBudget: 1024,
      } as any) as any;

      expect(result.thinking).toBeUndefined();
      expect(result.thinkingBudget).toBeUndefined();
      expect(result.reasoning_effort).toBeUndefined();
    });

    it('drops sampling parameters that GPT reasoning models refuse', () => {
      const result = handlePayload({
        messages: [{ content: 'Hi', role: 'user' }],
        model: 'gpt-6.2-sol',
        reasoning_effort: 'high',
        temperature: 0.7,
        top_p: 0.9,
      } as any) as any;

      expect(result.top_p).toBeUndefined();
      expect(result.temperature).toBeUndefined();
      expect(result.reasoning_effort).toBe('high');
    });

    it('keeps tools and sampling parameters', () => {
      const tools = [{ function: { name: 'get_weather', parameters: {} }, type: 'function' }];
      const result = handlePayload({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gemini-4-argon',
        temperature: 0.4,
        tools,
      } as any);

      expect(result.tools).toEqual(tools);
      expect(result.temperature).toBe(0.4);
      expect(result.messages).toEqual([{ content: 'Hello', role: 'user' }]);
    });
  });

  describe('API mode', () => {
    it('sends GPT-6 chats to Chat Completions, since the endpoint has no Responses API', async () => {
      const instance = new LobeAPIStoreAI({ apiKey: 'test' });
      const completions = vi
        .spyOn(instance['client'].chat.completions, 'create')
        .mockResolvedValue(new ReadableStream() as any);
      const responses = vi
        .spyOn(instance['client'].responses, 'create')
        .mockResolvedValue(new ReadableStream() as any);

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'gpt-6.2-sol',
        temperature: 1,
      });

      expect(completions).toHaveBeenCalledTimes(1);
      expect(responses).not.toHaveBeenCalled();
    });
  });

  describe('caller-selected Responses mode', () => {
    it.each(['claude-sonnet-5-5', 'gpt-6.2-sol'])(
      'still sends %s to Chat Completions when the caller asks for Responses',
      async (model) => {
        const instance = new LobeAPIStoreAI({ apiKey: 'test' });
        const completions = vi
          .spyOn(instance['client'].chat.completions, 'create')
          .mockResolvedValue(new ReadableStream() as any);
        const responses = vi
          .spyOn(instance['client'].responses, 'create')
          .mockResolvedValue(new ReadableStream() as any);

        await instance.chat({
          apiMode: 'responses',
          messages: [{ content: 'Hello', role: 'user' }],
          model,
          temperature: 1,
        } as any);

        expect(responses).not.toHaveBeenCalled();
        expect(completions).toHaveBeenCalledTimes(1);
        expect(completions.mock.calls[0][0]).not.toHaveProperty('apiMode');
      },
    );
  });

  describe('debug', () => {
    it('is off unless DEBUG_APISTORE_CHAT_COMPLETION is 1', () => {
      delete process.env.DEBUG_APISTORE_CHAT_COMPLETION;
      expect(params.debug.chatCompletion()).toBe(false);

      process.env.DEBUG_APISTORE_CHAT_COMPLETION = '1';
      expect(params.debug.chatCompletion()).toBe(true);
      delete process.env.DEBUG_APISTORE_CHAT_COMPLETION;
    });
  });

  describe('models', () => {
    const mockClient = { models: { list: vi.fn() } };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('lists only chat models and keeps their limits and names', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            context_length: 200_000,
            id: 'claude-haiku-4-5',
            kind: 'chat',
            max_output_tokens: 64_000,
            name: 'Claude Haiku 4.5',
            object: 'model',
            owned_by: 'anthropic',
          },
          { id: 'Seedance-2.5', kind: 'video', name: 'Seedance 2.5', object: 'model' },
          { id: 'gpt-image-2', kind: 'image', name: 'GPT Image 2', object: 'model' },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        contextWindowTokens: 200_000,
        displayName: 'Claude Haiku 4.5',
        id: 'claude-haiku-4-5',
        maxOutput: 64_000,
      });
    });

    it('describes fetched models as served on Chat Completions, not by the vendor API', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'claude-opus-5-5', kind: 'chat' },
          { id: 'gemini-4-carbon', kind: 'chat' },
          { id: 'deepseek-v4-1-flash', kind: 'chat' },
        ],
      });

      const models = await params.models({ client: mockClient as any });
      const byId = Object.fromEntries(models.map((m) => [m.id, m]));

      for (const model of models) {
        expect(model.search).toBe(false);
        expect(model.video).toBe(false);
        expect(model.settings?.extendParams).toEqual(['reasoningEffort']);
        expect(model.settings?.searchImpl).toBeUndefined();
      }
      expect(byId['claude-opus-5-5'].vision).toBe(true);
      expect(byId['gemini-4-carbon'].vision).toBe(true);
      expect(byId['deepseek-v4-1-flash'].vision).toBe(false);
    });

    it('keeps entries without a kind', async () => {
      mockClient.models.list.mockResolvedValue({ data: [{ id: 'gpt-6.2-sol' }] });

      const models = await params.models({ client: mockClient as any });

      expect(models.map((m) => m.id)).toEqual(['gpt-6.2-sol']);
    });

    it('returns an empty list when the response has no data', async () => {
      mockClient.models.list.mockResolvedValue({});

      expect(await params.models({ client: mockClient as any })).toEqual([]);
    });
  });
});
