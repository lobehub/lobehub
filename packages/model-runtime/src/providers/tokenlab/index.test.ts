// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { fromTokenLab, isUsableChatModel, LobeTokenLabAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

testProvider({
  Runtime: LobeTokenLabAI,
  provider: ModelProvider.TokenLab,
  defaultBaseURL: 'https://api.tokenlab.sh/v1',
  chatDebugEnv: 'DEBUG_TOKENLAB_CHAT_COMPLETION',
  chatModel: 'deepseek-v4-pro',
});

const chatRow = {
  id: 'claude-sonnet-5-5',
  object: 'model',
  owned_by: 'anthropic',
  tokenlab: {
    cache_pricing: { cache_read_per_1m: '0.06', cache_write_per_1m: '0.75' },
    capabilities: ['json-mode', 'prompt-cache', 'reasoning', 'tool-use', 'vision'],
    category: 'chat',
    lifecycle: { stage: 'active' },
    max_input_tokens: 1_000_000,
    max_output_tokens: 128_000,
    official_pricing: { input_per_1m: '3', output_per_1m: '15' },
    pricing: { input_per_1m: '0.6', output_per_1m: '3' },
  },
};

describe('LobeTokenLabAI', () => {
  it('names the client in the request headers', () => {
    expect(params.constructorOptions.defaultHeaders['X-TokenLab-Client-Source']).toBe('lobehub');
  });

  describe('fromTokenLab', () => {
    it("takes each model's own window, reply limit and price", () => {
      const card = fromTokenLab(chatRow);

      expect(card.contextWindowTokens).toBe(1_000_000);
      expect(card.maxOutput).toBe(128_000);
      expect(card.pricing).toEqual({
        cachedInput: 0.06,
        input: 0.6,
        output: 3,
        writeCacheInput: 0.75,
      });
    });

    it('maps the listed capabilities to abilities', () => {
      const card = fromTokenLab(chatRow);

      expect(card.functionCall).toBe(true);
      expect(card.reasoning).toBe(true);
      expect(card.vision).toBe(true);
      expect(card.search).toBe(false);
    });

    it('leaves abilities to model-bank when the gateway lists none', () => {
      const card = fromTokenLab({
        id: 'allam-2-7b',
        tokenlab: { capabilities: [], category: 'chat', max_input_tokens: 32_768 },
      });

      expect(card).not.toHaveProperty('functionCall');
      expect(card).not.toHaveProperty('vision');
      expect(card.contextWindowTokens).toBe(32_768);
    });

    it('falls back to the official price when TokenLab has no own price', () => {
      const card = fromTokenLab({
        id: 'allam-2-7b',
        tokenlab: {
          category: 'chat',
          official_pricing: { input_per_1m: '0.05', output_per_1m: '0.08' },
          pricing: { input_per_1m: null, output_per_1m: null },
        },
      });

      expect(card.pricing.input).toBe(0.05);
      expect(card.pricing.output).toBe(0.08);
    });

    it('drops limits the gateway does not know', () => {
      const card = fromTokenLab({ id: 'x', tokenlab: { max_input_tokens: null } });

      expect(card.contextWindowTokens).toBeUndefined();
      expect(card.maxOutput).toBeUndefined();
    });
  });

  describe('isUsableChatModel', () => {
    it('keeps chat models and drops the other categories', () => {
      expect(isUsableChatModel(chatRow)).toBe(true);
      expect(isUsableChatModel({ id: 'flux-2', tokenlab: { category: 'image' } })).toBe(false);
      expect(isUsableChatModel({ id: 'embed-1', tokenlab: { category: 'embedding' } })).toBe(false);
    });

    it('drops retired models but keeps deprecated ones, which still answer', () => {
      expect(
        isUsableChatModel({
          id: 'a',
          tokenlab: { category: 'chat', lifecycle: { stage: 'retired' } },
        }),
      ).toBe(false);
      expect(
        isUsableChatModel({
          id: 'b',
          tokenlab: { category: 'chat', lifecycle: { stage: 'deprecated' } },
        }),
      ).toBe(true);
    });
  });

  describe('models', () => {
    it('lists only chat models with their own limits', async () => {
      const client = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [chatRow, { id: 'flux-2', tokenlab: { category: 'image' } }],
          }),
        },
      };

      const models = await params.models({ client: client as any });

      expect(models.map((model) => model.id)).toEqual(['claude-sonnet-5-5']);
      expect(models[0].contextWindowTokens).toBe(1_000_000);
      expect(models[0].maxOutput).toBe(128_000);
      expect(models[0].functionCall).toBe(true);
    });
  });
});
