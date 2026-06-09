// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeOrcaRouterAI, params } from './index';

testProvider({
  Runtime: LobeOrcaRouterAI,
  chatDebugEnv: 'DEBUG_ORCAROUTER_CHAT_COMPLETION',
  chatModel: 'orcarouter/auto',
  defaultBaseURL: 'https://api.orcarouter.ai/v1',
  provider: ModelProvider.OrcaRouter,
  test: {
    skipAPICall: true,
  },
});

describe('LobeOrcaRouterAI - custom features', () => {
  describe('params object', () => {
    it('should export params with correct baseURL', () => {
      expect(params.baseURL).toBe('https://api.orcarouter.ai/v1');
    });

    it('should have correct provider', () => {
      expect(params.provider).toBe(ModelProvider.OrcaRouter);
    });

    it('should inject HTTP-Referer + X-Title attribution headers', () => {
      const headers = params.constructorOptions?.defaultHeaders as Record<string, string>;
      expect(headers['HTTP-Referer']).toBe('https://lobehub.com');
      expect(headers['X-Title']).toBe('LobeHub');
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_ORCAROUTER_CHAT_COMPLETION;
      expect(params.debug.chatCompletion()).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_ORCAROUTER_CHAT_COMPLETION = '1';
      expect(params.debug.chatCompletion()).toBe(true);
      delete process.env.DEBUG_ORCAROUTER_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('passes top-level reasoning_effort through for OpenAI gpt-5 family', () => {
      const result = params.chatCompletion.handlePayload!({
        messages: [{ content: 'hi', role: 'user' as const }],
        model: 'openai/gpt-5',
        reasoning_effort: 'high',
      } as any) as any;
      expect(result.reasoning_effort).toBe('high');
      // gpt-5 is reasoning-only — temperature must be stripped
      expect(result.temperature).toBeUndefined();
    });

    it('emits Anthropic native thinking block for claude opus 4.x', () => {
      const result = params.chatCompletion.handlePayload!({
        messages: [{ content: 'hi', role: 'user' as const }],
        model: 'anthropic/claude-opus-4.7',
        temperature: 0.7,
        thinking: { budget_tokens: 2000, type: 'enabled' },
      } as any) as any;
      expect(result.thinking).toEqual({ budget_tokens: 2000, type: 'enabled' });
      // claude-opus-4.x rejects temperature/top_p
      expect(result.temperature).toBeUndefined();
      expect(result.top_p).toBeUndefined();
    });

    it('does not strip temperature for non-reasoning models', () => {
      const result = params.chatCompletion.handlePayload!({
        messages: [{ content: 'hi', role: 'user' as const }],
        model: 'openai/gpt-4o',
        temperature: 0.7,
      } as any) as any;
      expect(result.temperature).toBe(0.7);
      expect(result.reasoning_effort).toBeUndefined();
    });

    it('strips temperature for deepseek-reasoner', () => {
      const result = params.chatCompletion.handlePayload!({
        messages: [{ content: 'hi', role: 'user' as const }],
        model: 'deepseek/deepseek-reasoner',
        temperature: 0.5,
      } as any) as any;
      expect(result.temperature).toBeUndefined();
    });

    it('preserves messages and other parameters', () => {
      const messages = [{ content: 'hi', role: 'user' as const }];
      const result = params.chatCompletion.handlePayload!({
        max_tokens: 100,
        messages,
        model: 'openai/gpt-4o',
        top_p: 0.9,
      } as any) as any;
      expect(result.messages).toEqual(messages);
      expect(result.max_tokens).toBe(100);
      expect(result.top_p).toBe(0.9);
    });
  });

  describe('models', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('filters non-chat models and computes USD pricing from ratios', async () => {
      const samplePricing = [
        {
          completion_ratio: 4,
          context_length: 128_000,
          max_completion_tokens: 16_384,
          model_name: 'openai/gpt-4o',
          model_ratio: 1.25,
          supported_endpoint_types: ['openai'],
          supported_parameters: ['tools', 'temperature'],
        },
        {
          completion_ratio: 8,
          context_length: 400_000,
          model_name: 'openai/gpt-5',
          model_ratio: 0.625,
          supported_endpoint_types: ['openai'],
          supported_parameters: ['tools', 'reasoning_effort'],
        },
        {
          cache_ratio: 0.1,
          completion_ratio: 5,
          context_length: 200_000,
          create_cache_ratio: 1.25,
          model_name: 'anthropic/claude-opus-4.7',
          model_ratio: 2.5,
          supported_endpoint_types: ['openai', 'anthropic'],
          supported_parameters: ['tools'],
        },
        // Should be filtered out:
        {
          completion_ratio: 1,
          model_name: 'openai/dall-e-3',
          model_ratio: 1,
          supported_endpoint_types: ['image-generation'],
        },
        {
          completion_ratio: 1,
          model_name: 'openai/text-embedding-3-small',
          model_ratio: 0.01,
          supported_endpoint_types: ['openai'],
        },
        {
          completion_ratio: 1,
          model_name: 'openai/gpt-5-codex',
          model_ratio: 0.5,
          supported_endpoint_types: ['openai'],
        },
        {
          completion_ratio: 1,
          model_name: 'openai/gpt-5-pro',
          model_ratio: 5,
          supported_endpoint_types: ['openai-response'],
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => samplePricing,
      } as any);

      const list = await params.models!({ client: {} as any });
      const ids = list.map((m: any) => m.id);
      expect(ids).toContain('openai/gpt-4o');
      expect(ids).toContain('openai/gpt-5');
      expect(ids).toContain('anthropic/claude-opus-4.7');
      expect(ids).not.toContain('openai/dall-e-3');
      expect(ids).not.toContain('openai/text-embedding-3-small');
      expect(ids).not.toContain('openai/gpt-5-codex');
      expect(ids).not.toContain('openai/gpt-5-pro');

      const gpt4o = list.find((m: any) => m.id === 'openai/gpt-4o') as any;
      expect(gpt4o).toBeDefined();
      expect(gpt4o.functionCall).toBe(true);

      const opus = list.find((m: any) => m.id === 'anthropic/claude-opus-4.7') as any;
      expect(opus).toBeDefined();
      expect(opus.reasoning).toBe(true);
    });

    it('returns empty list when pricing fetch fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const list = await params.models!({ client: {} as any });
      expect(list).toEqual([]);
      warnSpy.mockRestore();
    });

    it('returns empty list when pricing response is non-ok', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false } as any);
      const list = await params.models!({ client: {} as any });
      expect(list).toEqual([]);
    });
  });
});
