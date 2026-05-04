import { describe, expect, it } from 'vitest';

import {
  calculateMessageTokens,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_THRESHOLD_RATIO,
  estimateTokens,
  getCompressionThreshold,
  resolveCompressionMode,
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
      expect(threshold).toBe(89_600); // 128k * 0.7
    });

    it('should use custom maxWindowToken', () => {
      const threshold = getCompressionThreshold({ maxWindowToken: 200_000 });
      expect(threshold).toBe(140_000); // 200k * 0.7
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
      // Use a large enough maxWindowToken to avoid hitting the minimum buffer protection
      const threshold = getCompressionThreshold({
        maxWindowToken: 100_000,
        thresholdRatio: 0.33,
      });
      expect(threshold).toBe(33_000); // floor(100k * 0.33) = 33k
    });

    it('should apply minimum buffer protection for 64k context', () => {
      const threshold = getCompressionThreshold({ maxWindowToken: 64_000 });
      // 64k * 0.7 = 44.8k, but maxSafeThreshold = 64k - 20k = 44k
      // Math.min(44800, 44000) = 44000
      expect(threshold).toBe(44_000);
    });

    it('should apply minimum buffer protection for 32k context', () => {
      const threshold = getCompressionThreshold({ maxWindowToken: 32_000 });
      // 32k * 0.7 = 22.4k, but maxSafeThreshold = 32k - 20k = 12k
      // Math.min(22400, 12000) = 12000
      expect(threshold).toBe(12_000);
    });

    it('should apply minimum buffer protection for 16k context', () => {
      const threshold = getCompressionThreshold({ maxWindowToken: 16_000 });
      // 16k * 0.7 = 11.2k, but maxSafeThreshold = 16k - 20k = -4k (negative)
      // Returns maxContext to disable compression
      expect(threshold).toBe(16_000);
    });

    it('should disable compression for very small context (< 20k)', () => {
      const threshold = getCompressionThreshold({ maxWindowToken: 8_000 });
      // maxSafeThreshold = 8k - 20k = -12k (negative)
      // Returns maxContext to disable compression
      expect(threshold).toBe(8_000);
    });

    it('should use 70% threshold for large context (≥128k)', () => {
      const threshold128k = getCompressionThreshold({ maxWindowToken: 128_000 });
      expect(threshold128k).toBe(89_600); // 128k * 0.7 = 89.6k

      const threshold200k = getCompressionThreshold({ maxWindowToken: 200_000 });
      expect(threshold200k).toBe(140_000); // 200k * 0.7 = 140k
    });

    it('should transition smoothly at buffer boundary', () => {
      // At exactly 20k buffer boundary
      const threshold = getCompressionThreshold({ maxWindowToken: 28_571 });
      // 28571 * 0.7 ≈ 19999, maxSafeThreshold = 28571 - 20000 = 8571
      // Math.min(19999, 8571) = 8571
      expect(threshold).toBe(8_571);
    });

    describe('economy mode', () => {
      it('should use 50% threshold for 128k context', () => {
        const threshold = getCompressionThreshold({
          mode: 'economy',
          maxWindowToken: 128_000,
        });
        expect(threshold).toBe(64_000); // 128k * 0.5 = 64k
      });

      it('should cap at 128k for large context models (1M)', () => {
        const threshold = getCompressionThreshold({
          mode: 'economy',
          maxWindowToken: 1_000_000,
        });
        // Capped at 128k, then 128k * 0.5 = 64k
        expect(threshold).toBe(64_000);
      });

      it('should use actual context for small context models (32k)', () => {
        const threshold = getCompressionThreshold({
          mode: 'economy',
          maxWindowToken: 32_000,
        });
        // min(32k, 128k) = 32k, then 32k * 0.5 = 16k
        // maxSafeThreshold = 32k - 20k = 12k
        // Math.min(16k, 12k) = 12k
        expect(threshold).toBe(12_000);
      });

      it('should use actual context for small context models (64k)', () => {
        const threshold = getCompressionThreshold({
          mode: 'economy',
          maxWindowToken: 64_000,
        });
        // min(64k, 128k) = 64k, then 64k * 0.5 = 32k
        // maxSafeThreshold = 64k - 20k = 44k
        // Math.min(32k, 44k) = 32k
        expect(threshold).toBe(32_000);
      });

      it('should disable compression for very small context (< 20k)', () => {
        const threshold = getCompressionThreshold({
          mode: 'economy',
          maxWindowToken: 16_000,
        });
        // min(16k, 128k) = 16k, then 16k * 0.5 = 8k
        // maxSafeThreshold = 16k - 20k = -4k (negative)
        // Returns maxContext to disable compression
        expect(threshold).toBe(16_000);
      });
    });

    describe('disabled mode', () => {
      it('should return maxContext for 128k context', () => {
        const threshold = getCompressionThreshold({
          mode: 'disabled',
          maxWindowToken: 128_000,
        });
        // Disabled mode returns maxContext, effectively disabling compression
        expect(threshold).toBe(128_000);
      });

      it('should return maxContext for large context (1M)', () => {
        const threshold = getCompressionThreshold({
          mode: 'disabled',
          maxWindowToken: 1_000_000,
        });
        // Disabled mode returns maxContext, effectively disabling compression
        expect(threshold).toBe(1_000_000);
      });

      it('should return maxContext for small context (32k)', () => {
        const threshold = getCompressionThreshold({
          mode: 'disabled',
          maxWindowToken: 32_000,
        });
        // Disabled mode returns maxContext, effectively disabling compression
        expect(threshold).toBe(32_000);
      });
    });
  });

  describe('resolveCompressionMode', () => {
    it('should prefer contextCompressionMode over enableContextCompression', () => {
      expect(
        resolveCompressionMode({
          contextCompressionMode: 'economy',
          enableContextCompression: true,
        }),
      ).toBe('economy');

      expect(
        resolveCompressionMode({
          contextCompressionMode: 'disabled',
          enableContextCompression: true,
        }),
      ).toBe('disabled');
    });

    it('should use enableContextCompression when contextCompressionMode is undefined', () => {
      expect(
        resolveCompressionMode({
          enableContextCompression: true,
        }),
      ).toBe('economy');

      expect(
        resolveCompressionMode({
          enableContextCompression: false,
        }),
      ).toBe('disabled');
    });

    it('should default to economy when both are undefined', () => {
      expect(resolveCompressionMode({})).toBe('economy');
    });

    it('should handle contextCompressionMode set to full', () => {
      expect(
        resolveCompressionMode({
          contextCompressionMode: 'full',
          enableContextCompression: false,
        }),
      ).toBe('full');
    });
  });

  describe('shouldCompress', () => {
    it('should return needsCompression=false when under threshold', () => {
      const messages = [{ content: 'Hi', role: 'user' }];
      const result = shouldCompress(messages);

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBeGreaterThan(0);
      expect(result.threshold).toBe(89_600); // 128k * 0.7
    });

    it('should return needsCompression=true when over threshold', () => {
      // Create a message with usage that exceeds threshold
      const messages = [
        {
          content: '',
          metadata: { usage: { totalOutputTokens: 100_000 } },
          role: 'assistant',
        },
      ];
      const result = shouldCompress(messages);

      expect(result.needsCompression).toBe(true);
      expect(result.currentTokenCount).toBe(100_000);
      expect(result.threshold).toBe(89_600); // 128k * 0.7
    });

    it('should return needsCompression=false when exactly at threshold', () => {
      const messages = [
        {
          content: '',
          metadata: { usage: { totalOutputTokens: 89_600 } },
          role: 'assistant',
        },
      ];
      const result = shouldCompress(messages);

      // Exactly at threshold should not trigger compression
      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBe(89_600);
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
        maxWindowToken: 100_000,
        thresholdRatio: 0.75,
      });

      // threshold = 100k * 0.75 = 75k, current = 50k < 75k
      // But with min buffer: maxSafeThreshold = 100k - 20k = 80k
      // Math.min(75k, 80k) = 75k, current = 50k < 75k, no compression needed
      expect(result.needsCompression).toBe(false);
      expect(result.threshold).toBe(75_000);

      // Let's use a smaller context to trigger compression
      const result2 = shouldCompress(messages, {
        maxWindowToken: 60_000,
        thresholdRatio: 0.75,
      });

      // threshold = 60k * 0.75 = 45k, but maxSafeThreshold = 60k - 20k = 40k
      // Math.min(45k, 40k) = 40k, current = 50k > 40k, compression needed
      expect(result2.needsCompression).toBe(true);
      expect(result2.threshold).toBe(40_000);
    });

    it('should handle empty messages', () => {
      const result = shouldCompress([]);

      expect(result.needsCompression).toBe(false);
      expect(result.currentTokenCount).toBe(0);
    });
  });

  describe('calculateMessageTokens with virtual messages', () => {
    it('should extract content from assistantGroup messages', () => {
      const messages = [
        {
          role: 'assistantGroup',
          content: '',
          children: [
            { id: '1', content: 'First response' },
            { id: '2', content: 'Second response' },
          ],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
      // Should count both children contents
      expect(tokens).toBeGreaterThan(estimateTokens('First response'));
    });

    it('should include tool arguments and results in assistantGroup', () => {
      const messages = [
        {
          role: 'assistantGroup',
          content: '',
          children: [
            {
              id: '1',
              content: 'Response',
              tools: [{ arguments: '{"city":"SF"}', result: { content: 'Weather data' } }],
            },
          ],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract content from supervisor messages', () => {
      const messages = [
        {
          role: 'supervisor',
          content: '',
          children: [{ id: '1', content: 'Supervisor response' }],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract content from tasks messages recursively', () => {
      const messages = [
        {
          role: 'tasks',
          content: '',
          tasks: [
            { id: '1', role: 'task', content: 'Task 1' },
            { id: '2', role: 'task', content: 'Task 2' },
          ],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract content from groupTasks messages', () => {
      const messages = [
        {
          role: 'groupTasks',
          content: '',
          tasks: [{ id: '1', role: 'task', content: 'Task A' }],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract content from agentCouncil messages', () => {
      const messages = [
        {
          role: 'agentCouncil',
          content: '',
          members: [
            { id: '1', role: 'assistant', content: 'Agent A' },
            { id: '2', role: 'assistant', content: 'Agent B' },
          ],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle nested assistantGroup in agentCouncil', () => {
      const messages = [
        {
          role: 'agentCouncil',
          content: '',
          members: [
            {
              id: '1',
              role: 'assistantGroup',
              content: '',
              children: [{ id: '2', content: 'Nested content' }],
            },
          ],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract content from compare messages', () => {
      const messages = [
        {
          role: 'compare',
          content: '',
          columns: [
            [{ id: '1', role: 'assistant', content: 'Column A' }],
            [{ id: '2', role: 'assistant', content: 'Column B' }],
          ],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract content from compareGroup messages', () => {
      const messages = [
        {
          role: 'compareGroup',
          content: '',
          columns: [[{ id: '1', role: 'assistant', content: 'Response A' }]],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should extract content from compressedGroup messages', () => {
      const messages = [
        {
          role: 'compressedGroup',
          content: 'Summary text',
          compressedMessages: [{ id: '1', role: 'user', content: 'Question' }],
          pinnedMessages: [{ id: '2', content: 'Important message' }],
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should include reasoning content in standard messages', () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Response',
          reasoning: { content: 'Thinking...' },
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(estimateTokens('Response'));
    });

    it('should include RAG query content in standard messages', () => {
      const messages = [
        {
          role: 'user',
          content: 'Question',
          ragQuery: 'search query',
          ragRawQuery: 'raw search query',
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(estimateTokens('Question'));
    });

    it('should include search/grounding content in standard messages', () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Response',
          search: {
            searchQueries: ['query1', 'query2'],
            citations: [{ title: 'Source A' }, { title: 'Source B' }],
          },
        },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(estimateTokens('Response'));
    });

    it('should return 0 for empty virtual messages', () => {
      const messages = [
        { role: 'assistantGroup', content: '' },
        { role: 'tasks', content: '' },
        { role: 'agentCouncil', content: '' },
      ];
      const tokens = calculateMessageTokens(messages);
      expect(tokens).toBe(0);
    });
  });
});
