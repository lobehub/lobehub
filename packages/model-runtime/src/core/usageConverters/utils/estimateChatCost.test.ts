import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  estimateChatCostFromMessages,
  estimateChatCostFromTokens,
  estimateChatOutputTokens,
  estimateOpenAIChatInputTokens,
} from './estimateChatCost';

describe('estimateChatCost', () => {
  describe('estimateChatOutputTokens', () => {
    it('applies the output ratio below the cap', () => {
      expect(estimateChatOutputTokens(4000)).toBe(2000);
      expect(estimateChatOutputTokens(1000)).toBe(500);
    });

    it('caps output tokens for large inputs', () => {
      expect(estimateChatOutputTokens(20_000)).toBe(8192);
      expect(estimateChatOutputTokens(1_000_000)).toBe(8192);
    });
  });

  describe('estimateOpenAIChatInputTokens', () => {
    it('counts text, tools, reasoning, and image input buckets', () => {
      const estimate = estimateOpenAIChatInputTokens(
        [
          {
            content: [
              { text: 'hello world', type: 'text' },
              { image_url: { url: 'https://example.com/image.png' }, type: 'image_url' },
            ],
            role: 'user',
          },
          {
            content: 'assistant response',
            reasoning: { content: 'hidden reasoning' },
            role: 'assistant',
            tool_calls: [
              {
                function: { arguments: '{"city":"Shanghai"}', name: 'weather' },
                id: 'call_1',
                type: 'function',
              },
            ],
          },
        ],
        {
          tools: [
            {
              function: {
                description: 'Get weather',
                name: 'weather',
                parameters: { type: 'object' },
              },
              type: 'function',
            },
          ],
        },
      );

      expect(estimate.imageTokens).toBe(1000);
      expect(estimate.textTokens).toBeGreaterThan(0);
      expect(estimate.totalTokens).toBe(estimate.textTokens + 1000);
    });

    it('handles assistant tool-call messages with null content', () => {
      const estimate = estimateOpenAIChatInputTokens([
        // @ts-expect-error OpenAI-compatible runtime payloads can contain null content.
        {
          content: null,
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{"city":"Shanghai"}', name: 'weather' },
              id: 'call_1',
              type: 'function',
            },
          ],
        },
      ]);

      expect(estimate.imageTokens).toBe(0);
      expect(estimate.textTokens).toBeGreaterThan(0);
      expect(estimate.totalTokens).toBe(estimate.textTokens);
    });
  });

  describe('estimateChatCostFromTokens', () => {
    it('uses total input tokens to select tiered rates', () => {
      const pricing: Pricing = {
        currency: 'USD',
        units: [
          {
            name: 'textInput',
            strategy: 'tiered',
            tiers: [
              { rate: 1, upTo: 100 },
              { rate: 2, upTo: 'infinity' },
            ],
            unit: 'millionTokens',
          },
          {
            name: 'textOutput',
            strategy: 'tiered',
            tiers: [
              { rate: 10, upTo: 100 },
              { rate: 20, upTo: 'infinity' },
            ],
            unit: 'millionTokens',
          },
        ],
      };

      const estimate = estimateChatCostFromTokens(pricing, {
        outputTextTokens: 10,
        textTokens: 120,
      });

      expect(estimate?.estimatedCost).toBe(0.000_44);
      expect(estimate?.breakdown.map((item) => item.segments?.[0]?.rate)).toEqual([2, 20]);
    });

    it('returns undefined when pricing is missing', () => {
      expect(estimateChatCostFromTokens(undefined, { textTokens: 1000 })).toBeUndefined();
    });
  });

  describe('estimateChatCostFromMessages', () => {
    it('builds a cost estimate from OpenAI chat messages', () => {
      const pricing: Pricing = {
        units: [
          { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        ],
      };

      const estimate = estimateChatCostFromMessages(pricing, [
        { content: 'hello world', role: 'user' },
      ]);

      expect(estimate?.estimatedCost).toBeGreaterThan(0);
      expect(estimate?.estimatedOutputTokens).toBeGreaterThan(0);
      expect(estimate?.totalInputTokens).toBeGreaterThan(0);
    });
  });
});
