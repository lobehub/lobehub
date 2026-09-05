import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  COMPRESSION_BUFFER_TOKENS,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_RECOMPRESSION_THRESHOLD_RATIO,
  getCompressionThreshold,
  MAX_OUTPUT_RESERVE_TOKENS,
  MIN_THRESHOLD_RATIO,
  shouldCompress,
} from './tokenCounter';

// Test fixtures only set the fields shouldCompress / countContextTokens read.
const mkMsg = (m: Partial<UIChatMessage> & { role: UIChatMessage['role'] }): UIChatMessage =>
  ({
    content: '',
    createdAt: 0,
    id: 'm',
    updatedAt: 0,
    ...m,
  }) as UIChatMessage;

describe('tokenCounter', () => {
  describe('getCompressionThreshold', () => {
    it('should reserve output room + buffer from the default window', () => {
      const threshold = getCompressionThreshold();

      // 128k - min(unknown, 20k) - 13k = 95k
      expect(threshold).toBe(
        DEFAULT_MAX_CONTEXT - MAX_OUTPUT_RESERVE_TOKENS - COMPRESSION_BUFFER_TOKENS,
      );
      expect(threshold).toBe(95_000);
    });

    it('should scale with the window rather than a flat fraction of it', () => {
      expect(getCompressionThreshold({ maxWindowToken: 200_000 })).toBe(167_000);
      expect(getCompressionThreshold({ maxWindowToken: 1_048_576 })).toBe(1_015_576);
    });

    // The regression this exists for: doubao-seed-1.6 has a 256k window, and the
    // old `window x 0.5` threshold summarized the entire history at ~102k raw
    // tokens (128k adjusted) - less than half way through the window.
    it('should let a 256k window run to ~87% before compressing', () => {
      const threshold = getCompressionThreshold({
        maxOutputToken: 32_000,
        maxWindowToken: 256_000,
      });

      // 256k - min(32k, 20k) - 13k = 223k, vs 128k under the old ratio
      expect(threshold).toBe(223_000);
      expect(threshold / 256_000).toBeGreaterThan(0.85);
    });

    it('should reserve only what a low-maxOutput model can actually emit', () => {
      // maxOutput below the 20k cap reserves the real number, freeing the rest
      expect(getCompressionThreshold({ maxOutputToken: 4_096, maxWindowToken: 128_000 })).toBe(
        110_904,
      );
    });

    it('should cap the reserve for models with huge maxOutput', () => {
      // 128k maxOutput must not eat the entire window
      expect(getCompressionThreshold({ maxOutputToken: 128_000, maxWindowToken: 256_000 })).toBe(
        223_000,
      );
    });

    // A non-positive threshold reads as "always compress" and loops forever.
    it('should floor small windows instead of going non-positive', () => {
      expect(getCompressionThreshold({ maxWindowToken: 32_000 })).toBe(
        Math.floor(32_000 * MIN_THRESHOLD_RATIO),
      );
      expect(getCompressionThreshold({ maxWindowToken: 8_000 })).toBe(4_000);
      expect(getCompressionThreshold({ maxWindowToken: 8_000 })).toBeGreaterThan(0);
    });

    it('should honour an explicit thresholdRatio override exactly', () => {
      expect(getCompressionThreshold({ thresholdRatio: 0.5 })).toBe(64_000); // 128k * 0.5
      expect(getCompressionThreshold({ maxWindowToken: 100_000, thresholdRatio: 0.8 })).toBe(
        80_000,
      );
    });

    it('should let an explicit ratio bypass the headroom floor', () => {
      // Explicit means explicit - callers opting into early compression are not
      // second-guessed by MIN_THRESHOLD_RATIO.
      expect(getCompressionThreshold({ maxWindowToken: 100_000, thresholdRatio: 0.1 })).toBe(
        10_000,
      );
    });

    // Hysteresis (#18626): a freshly compressed context sits just below the
    // ordinary threshold, so reusing it lets one small tool result trigger
    // another compression before the model can act on the summary.
    describe('recompression hysteresis', () => {
      it('should raise a ratio-configured threshold once a summary exists', () => {
        const initial = getCompressionThreshold({ maxWindowToken: 64_000, thresholdRatio: 0.5 });
        const after = getCompressionThreshold({
          hasExistingSummary: true,
          maxWindowToken: 64_000,
          thresholdRatio: 0.5,
        });

        expect(initial).toBe(32_000);
        expect(after).toBe(64_000 * DEFAULT_RECOMPRESSION_THRESHOLD_RATIO);
        expect(after).toBeGreaterThan(initial);
      });

      // The whole point of the headroom budget is that a 256k model runs to
      // ~87%. A 0.65 watermark would drag it back to 166k, so the default
      // hysteresis may only ever push the threshold later.
      it('should never drag a headroom threshold down to the watermark', () => {
        const options = { maxOutputToken: 32_000, maxWindowToken: 256_000 };

        expect(getCompressionThreshold(options)).toBe(223_000);
        expect(getCompressionThreshold({ ...options, hasExistingSummary: true })).toBe(223_000);
      });

      it('should not apply the watermark before any summary exists', () => {
        expect(getCompressionThreshold({ maxWindowToken: 64_000, thresholdRatio: 0.5 })).toBe(
          32_000,
        );
      });

      // Explicit config is an override, not a clamp — callers use it to
      // compress a summarized context EARLIER than the initial threshold.
      it('should honour an explicit watermark below the initial threshold', () => {
        expect(
          getCompressionThreshold({
            hasExistingSummary: true,
            maxWindowToken: 64_000,
            recompressionThresholdRatio: 0.6,
            thresholdRatio: 0.8,
          }),
        ).toBe(38_400);
      });

      it('should honour an explicit watermark above the headroom budget', () => {
        expect(
          getCompressionThreshold({
            hasExistingSummary: true,
            maxOutputToken: 32_000,
            maxWindowToken: 256_000,
            recompressionThresholdRatio: 0.95,
          }),
        ).toBe(243_200);
      });
    });

    it('should floor the result', () => {
      const threshold = getCompressionThreshold({
        maxWindowToken: 100,
        thresholdRatio: 0.33,
      });
      expect(threshold).toBe(33); // floor(100 * 0.33) = 33
    });
  });

  describe('shouldCompress', () => {
    it('should return needsCompression=false when under threshold', () => {
      const result = shouldCompress([mkMsg({ role: 'user', content: 'Hi' })]);

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBeGreaterThan(0);
      expect(result.threshold).toBe(95_000); // 128k - 20k - 13k
    });

    it('should return needsCompression=true when over threshold', () => {
      const result = shouldCompress([
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 90_000 } as any } as any,
        }),
      ]);

      expect(result.needsCompression).toBe(true);
      expect(result.currentTokenCount).toBe(90_000);
      expect(result.threshold).toBe(95_000); // 128k - 20k - 13k
    });

    it('should return needsCompression=true when raw count is at threshold (drift pushes over)', () => {
      // 1.25× default drift multiplier means raw==threshold → adjusted > threshold
      // → compression fires. This is intentional: we want to compress before the
      // upstream tokenizer overflows the model's context window.
      const result = shouldCompress([
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 95_000 } as any } as any,
        }),
      ]);

      expect(result.needsCompression).toBe(true);
      expect(result.currentTokenCount).toBe(95_000);
    });

    it('should NOT trigger at threshold when driftMultiplier is 1', () => {
      // Disabling drift restores strict "raw > threshold" semantics
      const result = shouldCompress(
        [
          mkMsg({
            role: 'assistant',
            metadata: { usage: { totalOutputTokens: 95_000 } as any } as any,
          }),
        ],
        { driftMultiplier: 1 },
      );

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBe(95_000);
    });

    it('should use custom options', () => {
      const result = shouldCompress(
        [
          mkMsg({
            role: 'assistant',
            metadata: { usage: { totalOutputTokens: 50_000 } as any } as any,
          }),
        ],
        {
          maxWindowToken: 60_000,
          thresholdRatio: 0.75,
        },
      );

      // threshold = 60k * 0.75 = 45k, current = 50k > 45k
      expect(result.needsCompression).toBe(true);
      expect(result.threshold).toBe(45_000);
    });

    it('should handle empty messages', () => {
      const result = shouldCompress([]);

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBe(0);
    });

    // Bug B: tool definitions also occupy the input window, so a
    // message payload that fits when tools are absent can overflow once tool
    // definitions are accounted for. Without this, compression only fires on
    // message size and leaves the tool budget to silently push the request
    // past the model's context window (openrouter "ExceededContextWindow").
    it('should count tool definition tokens against the budget', () => {
      const messages = [
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 50_000 } as any } as any,
        }),
      ];
      const options = { driftMultiplier: 1, maxWindowToken: 100_000, thresholdRatio: 0.6 };

      const withoutTools = shouldCompress(messages, options);
      expect(withoutTools.needsCompression).toBe(false);

      // A chunky tool manifest (~20K tokens of JSON) should push us over.
      const bigTool = {
        function: {
          description: 'x'.repeat(80_000),
          name: 'big_tool',
          parameters: { properties: {}, type: 'object' },
        },
        type: 'function',
      };
      const withTools = shouldCompress(messages, { ...options, tools: [bigTool] });

      expect(withTools.needsCompression).toBe(true);
      expect(withTools.currentTokenCount).toBeGreaterThan(withoutTools.currentTokenCount);
    });
  });
});
