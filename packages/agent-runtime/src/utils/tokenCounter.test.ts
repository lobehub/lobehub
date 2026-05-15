import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_CONTEXT,
  DEFAULT_THRESHOLD_RATIO,
  getCompressionThreshold,
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
    it('should use default values', () => {
      const threshold = getCompressionThreshold();
      expect(threshold).toBe(Math.floor(DEFAULT_MAX_CONTEXT * DEFAULT_THRESHOLD_RATIO));
      expect(threshold).toBe(64_000); // 128k * 0.5
    });

    it('should use custom maxWindowToken', () => {
      const threshold = getCompressionThreshold({ maxWindowToken: 200_000 });
      expect(threshold).toBe(100_000); // 200k * 0.5
    });

    it('should use custom thresholdRatio', () => {
      const threshold = getCompressionThreshold({ thresholdRatio: 0.5 });
      expect(threshold).toBe(64_000); // 128k * 0.5
    });

    it('should use both custom values', () => {
      const threshold = getCompressionThreshold({
        maxWindowToken: 100_000,
        thresholdRatio: 0.8,
      });
      expect(threshold).toBe(80_000); // 100k * 0.8
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
      expect(result.threshold).toBe(64_000); // 128k * 0.5
    });

    it('should return needsCompression=true when over threshold', () => {
      const result = shouldCompress([
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 70_000 } as any } as any,
        }),
      ]);

      expect(result.needsCompression).toBe(true);
      expect(result.currentTokenCount).toBe(70_000);
      expect(result.threshold).toBe(64_000); // 128k * 0.5
    });

    it('should return needsCompression=true when raw count is at threshold (drift pushes over)', () => {
      // 1.25× default drift multiplier means raw==threshold → adjusted > threshold
      // → compression fires. This is intentional: we want to compress before the
      // upstream tokenizer overflows the model's context window.
      const result = shouldCompress([
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 64_000 } as any } as any,
        }),
      ]);

      expect(result.needsCompression).toBe(true);
      expect(result.currentTokenCount).toBe(64_000);
    });

    it('should NOT trigger at threshold when driftMultiplier is 1', () => {
      // Disabling drift restores strict "raw > threshold" semantics
      const result = shouldCompress(
        [
          mkMsg({
            role: 'assistant',
            metadata: { usage: { totalOutputTokens: 64_000 } as any } as any,
          }),
        ],
        { driftMultiplier: 1 },
      );

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBe(64_000);
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
  });
});
