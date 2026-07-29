// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeVolcengineAI } from './index';

testProvider({
  Runtime: LobeVolcengineAI,
  provider: ModelProvider.Volcengine,
  defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  chatDebugEnv: 'DEBUG_VOLCENGINE_CHAT_COMPLETION',
  chatModel: 'doubao-pro-32k',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeVolcengineAI - custom features', () => {
  let instance: InstanceType<typeof LobeVolcengineAI>;

  beforeEach(() => {
    instance = new LobeVolcengineAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('handlePayload', () => {
    it('should add thinking for thinking-vision-pro model', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'thinking-vision-pro',
        thinking: {
          type: 'enabled',
          budget_tokens: 1000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
    });

    it('should add thinking for deepseek-v3-1 model', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v3-1',
        thinking: {
          type: 'enabled',
          budget_tokens: 2000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
    });

    it('should map deepseek-v4 thinking disabled to minimal reasoning_effort', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        thinking: {
          type: 'disabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'disabled' });
      expect(calledPayload.reasoning_effort).toBe('minimal');
    });

    it('should map deepseek-v4 thinking enabled without reasoning_effort to high reasoning_effort', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        thinking: {
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
      expect(calledPayload.reasoning_effort).toBe('high');
    });

    it('should preserve reasoning_effort for deepseek-v4 when explicitly set', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        reasoning_effort: 'max',
        thinking: {
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
      expect(calledPayload.reasoning_effort).toBe('max');
    });

    it('should fallback reasoning_effort max to high for deepseek-v4 under responses path (enabledSearch: true)', async () => {
      // Mock the Responses API client call
      vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(
        new ReadableStream() as any,
      );

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        reasoning_effort: 'max',
        enabledSearch: true,
        thinking: {
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].responses.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
      expect(calledPayload.reasoning.effort).toBe('high');
    });
  });
});
