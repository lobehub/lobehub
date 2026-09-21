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
      expect(estimateChatOutputTokens(4000)).toBe(400);
      expect(estimateChatOutputTokens(1000)).toBe(100);
    });

    it('uses 8192 as the fallback cap for large inputs', () => {
      expect(estimateChatOutputTokens(100_000)).toBe(8192);
      expect(estimateChatOutputTokens(1_000_000)).toBe(8192);
    });

    it('uses the effective request or model cap when provided', () => {
      expect(estimateChatOutputTokens(400_000, 32_000)).toBe(32_000);
      expect(estimateChatOutputTokens(400_000, 12_000)).toBe(12_000);
      expect(estimateChatOutputTokens(400_000, 4096)).toBe(4096);
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
      expect(estimate.videoTokens).toBe(0);
    });

    it('counts video inputs in the video token bucket', () => {
      const estimate = estimateOpenAIChatInputTokens(
        [
          {
            content: [
              { text: 'summarize this clip', type: 'text' },
              { type: 'video_url', video_url: { url: 'https://example.com/video.mp4' } },
            ],
            role: 'user',
          },
        ],
        { videoTokenEstimate: 1200 },
      );

      expect(estimate.imageTokens).toBe(0);
      expect(estimate.textTokens).toBeGreaterThan(0);
      expect(estimate.totalTokens).toBe(estimate.textTokens + 1200);
      expect(estimate.videoTokens).toBe(1200);
    });

    it('counts audio by duration with an explicit conservative fallback source', () => {
      const estimate = estimateOpenAIChatInputTokens(
        [
          {
            content: [
              {
                audio_url: {
                  durationMs: 2500,
                  url: 'https://example.com/known-duration.mp3',
                },
                type: 'audio_url',
              },
              {
                audio_url: { url: 'https://example.com/unknown-duration.mp3' },
                type: 'audio_url',
              },
            ],
            role: 'user',
          },
        ],
        { audioTokenEstimate: 1200, audioTokensPerSecond: 32 },
      );

      expect(estimate.audioTokens).toBe(1200 + 1200);
      expect(estimate.audioDurationItemCount).toBe(1);
      expect(estimate.audioFallbackItemCount).toBe(1);
      expect(estimate.audioTokenEstimateSource).toBe('mixed');
      expect(estimate.totalTokens).toBe(estimate.textTokens + estimate.audioTokens);
    });

    it('never serializes an audio URL into the text token bucket', () => {
      const estimate = (url: string) =>
        estimateOpenAIChatInputTokens(
          [
            {
              content: [{ audio_url: { durationMs: 1000, url }, type: 'audio_url' }],
              role: 'user',
            },
          ],
          { audioTokensPerSecond: 32 },
        );

      expect(estimate('a').textTokens).toBe(
        estimate(`https://example.com/${'very-long-path/'.repeat(100)}audio.mp3`).textTokens,
      );
    });

    it('handles assistant tool-call messages with null content', () => {
      const estimate = estimateOpenAIChatInputTokens([
        {
          // @ts-expect-error OpenAI-compatible runtime payloads can contain null content.
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
      expect(estimate.videoTokens).toBe(0);
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

    it('forwards the effective output cap into the estimated usage', () => {
      const pricing: Pricing = {
        units: [{ name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
      };

      const estimate = estimateChatCostFromTokens(pricing, {
        maxOutputTokens: 12_000,
        textTokens: 200_000,
      });

      expect(estimate?.estimatedOutputTokens).toBe(12_000);
    });

    it('falls multimodal input back to text pricing when dedicated modality units are missing', () => {
      const pricing: Pricing = {
        units: [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
      };

      const estimate = estimateChatCostFromTokens(pricing, {
        audioTokens: 400,
        imageTokens: 200,
        outputTextTokens: 0,
        textTokens: 100,
        videoTokens: 300,
      });

      expect(estimate?.estimatedCost).toBe(0.001);
      expect(estimate?.inputAudioTokens).toBe(400);
      expect(estimate?.inputImageTokens).toBe(200);
      expect(estimate?.inputTextTokens).toBe(100);
      expect(estimate?.inputVideoTokens).toBe(300);
      expect(estimate?.totalInputTokens).toBe(1000);
      expect(estimate?.breakdown.find((item) => item.unit.name === 'textInput')?.quantity).toBe(
        1000,
      );
    });

    it('keeps modality input separate when dedicated modality units exist', () => {
      const pricing: Pricing = {
        units: [
          { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        ],
      };

      const estimate = estimateChatCostFromTokens(pricing, {
        imageTokens: 200,
        outputTextTokens: 0,
        textTokens: 100,
      });

      expect(estimate?.breakdown.find((item) => item.unit.name === 'textInput')?.quantity).toBe(
        100,
      );
      expect(estimate?.breakdown.find((item) => item.unit.name === 'imageInput')?.quantity).toBe(
        200,
      );
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
      expect(estimate?.usage.totalTokens).toBe(
        estimate!.totalInputTokens + estimate!.estimatedOutputTokens,
      );
    });

    it('forwards the effective output cap into the message estimate', () => {
      const pricing: Pricing = {
        units: [{ name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
      };

      const estimate = estimateChatCostFromMessages(
        pricing,
        [{ content: 'hello world '.repeat(100), role: 'user' }],
        { maxOutputTokens: 1 },
      );

      expect(estimate?.estimatedOutputTokens).toBe(1);
    });

    it('forwards video inputs to video pricing units', () => {
      const pricing: Pricing = {
        units: [{ name: 'videoInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' }],
      };

      const estimate = estimateChatCostFromMessages(
        pricing,
        [
          {
            content: [{ type: 'video_url', video_url: { url: 'https://example.com/video.mp4' } }],
            role: 'user',
          },
        ],
        { videoTokenEstimate: 2000 },
      );

      expect(estimate?.estimatedCost).toBe(0.006);
      expect(estimate?.inputVideoTokens).toBe(2000);
      expect(estimate?.totalInputTokens).toBeGreaterThan(2000);
      expect(estimate?.breakdown.map((item) => item.unit.name)).toEqual(['videoInput']);
    });

    it('uses the model pricing audio rate and exposes the estimate source', () => {
      const pricing: Pricing = {
        audioTokensPerSecond: 32,
        units: [{ name: 'audioInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' }],
      };

      const estimate = estimateChatCostFromMessages(pricing, [
        {
          content: [
            {
              audio_url: { durationMs: 2500, url: 'https://example.com/audio.mp3' },
              type: 'audio_url',
            },
          ],
          role: 'user',
        },
      ]);

      expect(estimate?.inputAudioTokens).toBe(1000);
      expect(estimate?.audioDurationItemCount).toBe(1);
      expect(estimate?.audioFallbackItemCount).toBe(0);
      expect(estimate?.audioTokenEstimateSource).toBe('duration');
      expect(estimate?.estimatedCost).toBe(0.002);
      expect(estimate?.breakdown.map((item) => item.unit.name)).toEqual(['audioInput']);
    });

    it('bills estimated image inputs through text pricing when image pricing is unavailable', () => {
      const pricing: Pricing = {
        units: [{ name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' }],
      };

      const estimate = estimateChatCostFromMessages(
        pricing,
        [
          {
            content: [{ image_url: { url: 'https://example.com/image.png' }, type: 'image_url' }],
            role: 'user',
          },
        ],
        { imageTokenEstimate: 2000 },
      );

      expect(estimate?.inputImageTokens).toBe(2000);
      expect(estimate?.totalInputTokens).toBeGreaterThan(2000);
      expect(estimate?.breakdown.find((item) => item.unit.name === 'textInput')?.quantity).toBe(
        estimate?.totalInputTokens,
      );
    });
  });
});
