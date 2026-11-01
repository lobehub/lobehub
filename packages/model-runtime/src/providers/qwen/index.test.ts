// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeQwenAI, params } from './index';

// Avoid pulling the real business model-config module (it may resolve to a
// server-only implementation under pnpm overrides)
vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const provider = ModelProvider.Qwen;
const defaultBaseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

testProvider({
  Runtime: LobeQwenAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_QWEN_CHAT_COMPLETION',
  chatModel: 'qwen-2.5',
  test: {
    skipAPICall: true,
  },
});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeQwenAI({ apiKey: 'test' });

  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

describe('LobeQwenAI - custom features', () => {
  describe('prompt_cache_key', () => {
    it('should not inject Moonshot prompt_cache_key for Kimi model ids', async () => {
      await instance.chat(
        {
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'kimi-k2.6',
        },
        { user: 'user-abc' },
      );

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.prompt_cache_key).toBeUndefined();
    });
  });

  describe('thinking payload mapping', () => {
    it('should forward enable_thinking and reasoning_effort for deepseek-v4 models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro',
        reasoning_effort: 'high',
        thinking: {
          budget_tokens: 2048,
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.reasoning_effort).toBe('high');
      expect(calledPayload.thinking_budget).toBeUndefined();
    });

    it('should remove reasoning_effort when deepseek-v4 thinking is disabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-flash',
        reasoning_effort: 'high',
        thinking: {
          budget_tokens: 2048,
          type: 'disabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(false);
      expect(calledPayload.reasoning_effort).toBeUndefined();
      expect(calledPayload.thinking_budget).toBeUndefined();
    });

    it('should forward enable_thinking and reasoning_effort for qwen3.8-max', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.8-max',
        reasoning_effort: 'medium',
        thinking: {
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.reasoning_effort).toBe('medium');
    });

    it.each(['qwen3.8-max', 'qwen3.8-max-preview', 'qwen3.8-max-0902'])(
      'should prefer reasoning effort over the thinking budget for %s',
      async (model) => {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model,
          reasoning_effort: 'medium',
          thinking: { budget_tokens: 4096, type: 'enabled' },
        });

        const calledPayload = vi.mocked(instance['client'].chat.completions.create).mock
          .calls[0][0];
        expect(calledPayload).toMatchObject({ enable_thinking: true, reasoning_effort: 'medium' });
        expect(JSON.stringify(calledPayload)).not.toContain('"thinking_budget":');
      },
    );

    it('should retain a Qwen3.8 budget when no effort is supplied', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.8-max',
        thinking: { budget_tokens: 4096, type: 'enabled' },
      });

      const calledPayload = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      expect(calledPayload).toMatchObject({ enable_thinking: true, thinking_budget: 4096 });
      expect(JSON.stringify(calledPayload)).not.toContain('"reasoning_effort":');
    });

    it('should drop reasoning_effort when qwen3.8-max thinking is disabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.8-max',
        reasoning_effort: 'xhigh',
        thinking: {
          type: 'disabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(false);
      expect(calledPayload.reasoning_effort).toBeUndefined();
    });

    it('should only send thinking_budget for budget-only non-thinking models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-r1-0528',
        thinking: {
          budget_tokens: 2048,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBeUndefined();
      expect(calledPayload.thinking_budget).toBe(2048);
    });

    it('should force enable_thinking even when thinking is disabled for thinking-forced models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.9-max',
        thinking: {
          budget_tokens: 0,
          type: 'disabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.thinking_budget).toBeUndefined();
    });

    it('should keep thinking_budget for thinking-forced models when thinking is enabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.9-max',
        thinking: {
          budget_tokens: 4096,
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.thinking_budget).toBe(4096);
    });

    it('should allow enable_thinking false for hybrid qwen3.8-max-preview', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.8-max-preview',
        reasoning_effort: 'xhigh',
        thinking: {
          type: 'disabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(false);
      expect(calledPayload.reasoning_effort).toBeUndefined();
    });

    it('should still force enable_thinking for dedicated thinking models', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3-235b-a22b-thinking-2507',
        thinking: {
          budget_tokens: 4096,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.thinking_budget).toBe(4096);
    });
  });

  describe('preserve thinking mapping', () => {
    it('should map preserveThinking to preserve_thinking for qwen3.6-plus', () => {
      const payload = {
        messages: [
          { content: 'hello', role: 'user' },
          {
            content: 'answer',
            reasoning: { content: 'reasoning content' },
            role: 'assistant',
          },
        ],
        model: 'qwen3.6-plus',
        preserveThinking: true,
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      expect(result.preserve_thinking).toBe(true);
      expect(result.messages).toEqual([
        { content: 'hello', role: 'user' },
        {
          content: 'answer',
          reasoning_content: 'reasoning content',
          role: 'assistant',
        },
      ]);
    });

    it('should set preserve_thinking=false when explicitly disabled on supported model', () => {
      const payload = {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'qwen3.6-plus',
        preserveThinking: false,
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      expect(result.preserve_thinking).toBe(false);
    });

    it('should map preserveThinking for deployment-name aliases when caller provides the param', () => {
      const payload = {
        messages: [
          {
            content: 'answer',
            reasoning: { content: 'reasoning content' },
            role: 'assistant',
          },
        ],
        model: 'my-qwen3.6-plus-deployment',
        preserveThinking: true,
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      expect(result.preserve_thinking).toBe(true);
      expect(result.messages).toEqual([
        {
          content: 'answer',
          reasoning_content: 'reasoning content',
          role: 'assistant',
        },
      ]);
    });

    it('should not set preserve_thinking when preserveThinking is absent but still keep reasoning_content', () => {
      const payload = {
        messages: [
          {
            content: 'answer',
            reasoning: { content: 'reasoning content' },
            role: 'assistant',
          },
        ],
        model: 'qwen3.5-plus',
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      expect(result.preserve_thinking).toBeUndefined();
      expect(result.messages).toEqual([
        {
          content: 'answer',
          reasoning_content: 'reasoning content',
          role: 'assistant',
        },
      ]);
    });

    it('should keep caller-provided reasoning_content', () => {
      const payload = {
        messages: [
          {
            content: 'answer',
            reasoning_content: 'existing reasoning content',
            role: 'assistant',
          },
        ],
        model: 'qwen3.5-plus',
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      expect(result.messages).toEqual([
        {
          content: 'answer',
          reasoning_content: 'existing reasoning content',
          role: 'assistant',
        },
      ]);
    });
  });
});
