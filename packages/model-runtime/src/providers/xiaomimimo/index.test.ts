// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeXiaomiMiMoAI, params } from './index';

const provider = ModelProvider.XiaomiMiMo;
const defaultBaseURL = 'https://api.xiaomimimo.com/v1';

testProvider({
  Runtime: LobeXiaomiMiMoAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_XIAOMIMIMO_CHAT_COMPLETION',
  chatModel: 'mimo-v2-flash',
  test: {
    skipAPICall: true,
  },
});

describe('LobeXiaomiMiMoAI - custom features', () => {
  describe('chatCompletion.handlePayload', () => {
    it('should map max_tokens to max_completion_tokens', () => {
      const payload = {
        max_tokens: 1000,
        model: 'mimo-v2-flash',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.max_completion_tokens).toBe(1000);
      expect(result.max_tokens).toBeUndefined();
    });

    it('should set stream to true by default', () => {
      const payload = {
        model: 'mimo-v2-flash',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.stream).toBe(true);
    });

    it('should preserve existing stream value', () => {
      const payload = {
        model: 'mimo-v2-flash',
        stream: false,
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.stream).toBe(false);
    });

    it('should clamp temperature between 0 and 1.5', () => {
      const payloadLow = {
        temperature: -1,
        model: 'mimo-v2-flash',
      };
      const resultLow = params.chatCompletion!.handlePayload!(payloadLow as any);
      expect(resultLow.temperature).toBe(0);

      const payloadHigh = {
        temperature: 2,
        model: 'mimo-v2-flash',
      };
      const resultHigh = params.chatCompletion!.handlePayload!(payloadHigh as any);
      expect(resultHigh.temperature).toBe(1.5);

      const payloadNormal = {
        temperature: 0.7,
        model: 'mimo-v2-flash',
      };
      const resultNormal = params.chatCompletion!.handlePayload!(payloadNormal as any);
      expect(resultNormal.temperature).toBe(0.7);
    });

    it('should clamp top_p between 0.01 and 1', () => {
      const payloadLow = {
        top_p: 0,
        model: 'mimo-v2-flash',
      };
      const resultLow = params.chatCompletion!.handlePayload!(payloadLow as any);
      expect(resultLow.top_p).toBe(0.01);

      const payloadHigh = {
        top_p: 1.5,
        model: 'mimo-v2-flash',
      };
      const resultHigh = params.chatCompletion!.handlePayload!(payloadHigh as any);
      expect(resultHigh.top_p).toBe(1);

      const payloadNormal = {
        top_p: 0.5,
        model: 'mimo-v2-flash',
      };
      const resultNormal = params.chatCompletion!.handlePayload!(payloadNormal as any);
      expect(resultNormal.top_p).toBe(0.5);
    });

    it('should handle thinking type enabled/disabled', () => {
      const payloadEnabled = {
        thinking: { type: 'enabled' },
        model: 'mimo-v2-flash',
      };
      const resultEnabled = params.chatCompletion!.handlePayload!(payloadEnabled as any);
      expect(resultEnabled.thinking).toEqual({ type: 'enabled' });

      const payloadDisabled = {
        thinking: { type: 'disabled' },
        model: 'mimo-v2-flash',
      };
      const resultDisabled = params.chatCompletion!.handlePayload!(payloadDisabled as any);
      expect(resultDisabled.thinking).toEqual({ type: 'disabled' });

      const payloadOther = {
        thinking: { type: 'other' },
        model: 'mimo-v2-flash',
      };
      const resultOther = params.chatCompletion!.handlePayload!(payloadOther as any);
      expect(resultOther.thinking).toBeUndefined();
    });

    it('should enable Xiaomi web search flag when enabledSearch is true', () => {
      const payload = {
        enabledSearch: true,
        model: 'mimo-v2-flash',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.webSearchEnabled).toBe(true);
      expect(result.tools).toEqual([{ type: 'web_search' }]);
    });

    it('should merge Xiaomi web search tool with existing tools', () => {
      const payload = {
        enabledSearch: true,
        model: 'mimo-v2-flash',
        tools: [{ function: { name: 'get_weather' }, type: 'function' }],
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.tools).toEqual([
        { function: { name: 'get_weather' }, type: 'function' },
        { type: 'web_search' },
      ]);
      expect(result.webSearchEnabled).toBe(true);
    });

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
        model: 'mimo-v2-flash',
        thinking: { type: 'enabled' },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

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
          { role: 'user', content: 'How are you?' },
        ],
        model: 'mimo-v2-flash',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual(payload.messages);
    });

    it('should handle empty reasoning content', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: 'Response',
            reasoning: { duration: 1000 },
          },
          { role: 'user', content: 'Continue' },
        ],
        model: 'mimo-v2-flash',
        thinking: { type: 'enabled' },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[1]).toEqual({
        role: 'assistant',
        content: 'Response',
        reasoning_content: '',
      });
    });

    it('should filter out empty user messages', () => {
      const payload = {
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: '   ' },
          { role: 'user', content: [] },
          { role: 'user', content: 'Hello' },
        ],
        model: 'mimo-v2-flash',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('should drop trailing assistant messages Xiaomi does not accept', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Partial answer' },
        ],
        model: 'mimo-v2-flash',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('should preserve non-trailing assistant history while dropping only the tail assistant', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Earlier answer' },
          { role: 'user', content: 'Follow-up question' },
          { role: 'assistant', content: 'Pending continuation' },
        ],
        model: 'mimo-v2-flash',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Follow-up question' },
      ]);
    });
  });

  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_XIAOMIMIMO_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_XIAOMIMIMO_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_XIAOMIMIMO_CHAT_COMPLETION;
    });
  });

  describe('models', () => {
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
        data: [{ id: 'mimo-v2-pro' }, { id: 'mimo-v2-flash' }, { id: 'mimo-v2-omni' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('mimo-v2-pro');
      expect(models[1].id).toBe('mimo-v2-flash');
      expect(models[2].id).toBe('mimo-v2-omni');
    });

    it('should handle single model', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'mimo-v2-pro' }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('mimo-v2-pro');
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should process models with MODEL_LIST_CONFIGS', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'mimo-v2-pro' }],
      });

      const models = await params.models({ client: mockClient as any });

      // The processModelList function should merge with known model list
      expect(models[0]).toHaveProperty('id');
      expect(models[0].id).toBe('mimo-v2-pro');
    });

    it('should preserve model properties from API response', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'mimo-v2-pro', extra_field: 'value' },
          { id: 'mimo-v2-flash', another_field: 123 },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('mimo-v2-pro');
      expect(models[1].id).toBe('mimo-v2-flash');
    });

    it('should handle models with different id patterns', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'mimo-v2-pro' },
          { id: 'mimo-v2-omni' },
          { id: 'mimo-v2-flash' },
          { id: 'mimo-v2-other' },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(4);
      expect(models.every((m) => typeof m.id === 'string')).toBe(true);
    });
  });
});
