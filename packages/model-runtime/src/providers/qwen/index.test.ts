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
        model: 'qwen3.8-max-preview',
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
        model: 'qwen3.8-max-preview',
        thinking: {
          budget_tokens: 4096,
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.thinking_budget).toBe(4096);
    });

    it('should prefer normalized reasoning_effort over thinking_budget for qwen3.8 max', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.8-max-preview',
        reasoning_effort: 'high',
        thinking: {
          budget_tokens: 4096,
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.reasoning_effort).toBe('xhigh');
      expect(calledPayload.thinking_budget).toBeUndefined();
    });

    it('should ignore reasoning_effort none for thinking-only qwen3.8 max', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.8-max-preview',
        reasoning_effort: 'none',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.reasoning_effort).toBeUndefined();
    });

    it('should clamp qwen3.8 max temperature to the documented minimum', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.8-max-preview',
        temperature: 0.2,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];

      expect(calledPayload.temperature).toBe(0.6);
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

    it('should default preserve_thinking to false for qwen3.8 max when the switch is unset', () => {
      const payload = {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'qwen3.8-max-preview',
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      // Upstream preserves prior reasoning by default; an unset UI switch must not
      // silently keep it on (and bill it as input) while the control renders as off.
      expect(result.preserve_thinking).toBe(false);
    });

    it('should respect an explicit preserveThinking on qwen3.8 max', () => {
      const payload = {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'qwen3.8-max-preview',
        preserveThinking: true,
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      expect(result.preserve_thinking).toBe(true);
    });
  });

  describe('qwen3.8 max search', () => {
    it('should forward enable_search for provider-native search', () => {
      const payload = {
        enabledSearch: true,
        messages: [{ content: 'hello', role: 'user' }],
        model: 'qwen3.8-max-preview',
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      expect(result.enable_search).toBe(true);
      expect(result.search_options).toBeDefined();
    });
  });

  describe('qwen3.8 max deployment alias', () => {
    it('should apply qwen3.8 rules by logical id and send the deployment name as model', () => {
      const payload = {
        deploymentName: 'my-qwen-deployment',
        messages: [{ content: 'hello', role: 'user' }],
        model: 'qwen3.8-max-preview',
        reasoning_effort: 'high',
        temperature: 0.2,
      } as any;

      const result = params.chatCompletion!.handlePayload!(payload);

      // Rules resolve from the logical id even though the id is aliased...
      expect(result.enable_thinking).toBe(true);
      expect(result.reasoning_effort).toBe('xhigh');
      expect(result.temperature).toBe(0.6);
      expect(result.preserve_thinking).toBe(false);
      // ...while the upstream request carries the deployment alias as the model.
      expect(result.model).toBe('my-qwen-deployment');
      // The alias field itself must not leak into the outgoing payload.
      expect((result as any).deploymentName).toBeUndefined();
    });
  });
});
