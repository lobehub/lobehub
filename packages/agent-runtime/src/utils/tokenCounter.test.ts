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

    // Tool definitions do occupy the input window, but they are per-step
    // overhead that the caller has already reserved headroom for, and
    // compressing the transcript cannot shrink a tool manifest. Charging them to
    // the conversation budget meant a broadly tooled agent compressed its
    // history on nearly every turn while the overhead stayed put — measured at
    // 43.7k of a 64k budget spent before the user's first token.
    //
    // So they are excluded from the ratio threshold and covered by
    // MAX_PROMPT_RATIO instead, which is the assertion that actually matters:
    // the request must not approach the window. See the two tests below.
    it('should not let tool definitions alone trip the ratio threshold', () => {
      const messages = [
        mkMsg({
          role: 'assistant',
          metadata: { usage: { totalOutputTokens: 50_000 } as any } as any,
        }),
      ];
      const options = { driftMultiplier: 1, maxWindowToken: 100_000, thresholdRatio: 0.6 };

      const bigTool = {
        function: {
          description: 'x'.repeat(80_000),
          name: 'big_tool',
          parameters: { properties: {}, type: 'object' },
        },
        type: 'function',
      };
      const withTools = shouldCompress(messages, { ...options, tools: [bigTool] });

      // 50k conversation fits the 60k budget; 20k of tools is overhead on top.
      expect(withTools.needsCompression).toBe(false);
      // Still counted in the reported total — this is a budget change, not a
      // measurement change.
      expect(withTools.currentTokenCount).toBeGreaterThan(50_000);
    });

    it('should still compress when tool definitions push the request near the window', () => {
      const options = { driftMultiplier: 1, maxWindowToken: 100_000, thresholdRatio: 0.6 };
      // ~100k tokens of tool schema against an 80k (80% of window) ceiling. The
      // ratio threshold alone would not fire here: the budget grows by the same
      // overhead we are adding.
      const hugeTool = {
        function: {
          description: 'x'.repeat(600_000),
          name: 'huge_tool',
          parameters: { properties: {}, type: 'object' },
        },
        type: 'function',
      };

      const result = shouldCompress([mkMsg({ role: 'user', content: 'Hi' })], {
        ...options,
        tools: [hugeTool],
      });

      expect(result.needsCompression).toBe(true);
    });

    it('should exclude the system role and tool definitions from the conversation budget', () => {
      const messages = [
        mkMsg({ role: 'system', content: 's'.repeat(120_000) }),
        mkMsg({ role: 'user', content: 'u'.repeat(120_000) }),
      ];
      const options = { driftMultiplier: 1, maxWindowToken: 100_000, thresholdRatio: 0.6 };

      const result = shouldCompress(messages, {
        ...options,
        tools: [
          {
            function: {
              description: 'x'.repeat(120_000),
              name: 'tool',
              parameters: { properties: {}, type: 'object' },
            },
            type: 'function',
          },
        ],
      });

      // ~40k of system role + tool definitions, leaving the 60k conversation
      // budget to the ~27k of dialogue. The unfixed total (~67k) was over the
      // threshold, which is exactly the premature compression being corrected.
      expect(result.fixedOverhead).toBeGreaterThan(30_000);
      expect(result.needsCompression).toBe(false);
    });

    it('should compress once the conversation alone exceeds the budget', () => {
      const messages = [
        mkMsg({ role: 'system', content: 's'.repeat(60_000) }),
        mkMsg({ role: 'user', content: 'u'.repeat(400_000) }),
      ];
      const options = { driftMultiplier: 1, maxWindowToken: 100_000, thresholdRatio: 0.6 };

      const result = shouldCompress(messages, options);

      // ~67k of dialogue against a 60k budget, on top of ~10k of system role.
      // Stays under the 80k ceiling, so the ratio threshold is what fires.
      expect(result.fixedOverhead).toBeGreaterThan(5_000);
      expect(result.needsCompression).toBe(true);
    });
  });
});
