import { describe, expect, it } from 'vitest';

import {
  calculateMessageTokens,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_THRESHOLD_RATIO,
  estimateTokens,
  getCompressionThreshold,
  shouldCompress,
} from './tokenCounter';

describe('tokenCounter', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens for string content', () => {
      const tokens = estimateTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should handle null/undefined content', () => {
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });

    it('should handle object content by JSON stringifying', () => {
      const tokens = estimateTokens({ key: 'value', nested: { a: 1 } });
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle array content', () => {
      const tokens = estimateTokens(['item1', 'item2', 'item3']);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('calculateMessageTokens', () => {
    it('should use totalOutputTokens for assistant messages when available', () => {
      const messages = [
        {
          content: 'This content should be ignored',
          metadata: { usage: { totalOutputTokens: 100 } },
          role: 'assistant',
        },
      ];
      expect(calculateMessageTokens(messages)).toBe(100);
    });

    it('should estimate tokens for assistant messages without usage data', () => {
      const messages = [{ content: 'Hello from assistant', role: 'assistant' }];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
      // Should be estimated, not 0
      expect(tokens).not.toBe(100);
    });

    it('should estimate tokens for user messages', () => {
      const messages = [{ content: 'Hello from user', role: 'user' }];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens for system messages', () => {
      const messages = [{ content: 'System prompt', role: 'system' }];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should sum tokens from multiple messages', () => {
      const messages = [
        { content: 'Hello', role: 'user' },
        { content: 'Hi there!', metadata: { usage: { totalOutputTokens: 50 } }, role: 'assistant' },
        { content: 'How are you?', role: 'user' },
      ];
      const tokens = calculateMessageTokens(messages);
      // Should be 50 (assistant) + estimated tokens for user messages
      expect(tokens).toBeGreaterThan(50);
    });

    it('should handle empty messages array', () => {
      expect(calculateMessageTokens([])).toBe(0);
    });

    it('should handle messages with empty content', () => {
      const messages = [
        { content: '', role: 'user' },
        { content: undefined, role: 'assistant' },
      ];
      expect(calculateMessageTokens(messages)).toBe(0);
    });

    it('should skip assistant usage with 0 tokens and estimate instead', () => {
      const messages = [
        {
          content: 'Some content',
          metadata: { usage: { totalOutputTokens: 0 } },
          role: 'assistant',
        },
      ];
      const tokens = calculateMessageTokens(messages);
      // Should estimate since totalOutputTokens is 0
      expect(tokens).toBeGreaterThan(0);
    });
  });

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
      const messages = [{ content: 'Hi', role: 'user' }];
      const result = shouldCompress(messages);

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBeGreaterThan(0);
      expect(result.threshold).toBe(64_000); // 128k * 0.5
    });

    it('should return needsCompression=true when over threshold', () => {
      // Create a message with usage that exceeds threshold
      const messages = [
        {
          content: '',
          metadata: { usage: { totalOutputTokens: 70_000 } },
          role: 'assistant',
        },
      ];
      const result = shouldCompress(messages);

      expect(result.needsCompression).toBe(true);
      expect(result.currentTokenCount).toBe(70_000);
      expect(result.threshold).toBe(64_000); // 128k * 0.5
    });

    it('should return needsCompression=false when exactly at threshold', () => {
      const messages = [
        {
          content: '',
          metadata: { usage: { totalOutputTokens: 64_000 } },
          role: 'assistant',
        },
      ];
      const result = shouldCompress(messages);

      // Exactly at threshold should not trigger compression
      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBe(64_000);
    });

    it('should use custom options', () => {
      const messages = [
        {
          content: '',
          metadata: { usage: { totalOutputTokens: 50_000 } },
          role: 'assistant',
        },
      ];
      const result = shouldCompress(messages, {
        maxWindowToken: 60_000,
        thresholdRatio: 0.75,
      });

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
