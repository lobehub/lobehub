import { emoji } from 'chat';
import { describe, expect, it } from 'vitest';

import type { RenderStepParams } from '../replyTemplate';
import {
  formatTokens,
  renderError,
  renderFinalReply,
  renderLLMGenerating,
  renderStart,
  renderStepProgress,
  renderToolExecuting,
  splitMessage,
  summarizeOutput,
} from '../replyTemplate';

// Helper to build a minimal RenderStepParams with defaults
function makeParams(overrides: Partial<RenderStepParams> = {}): RenderStepParams {
  return {
    executionTimeMs: 0,
    stepType: 'call_llm' as const,
    thinking: true,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalSteps: 1,
    totalTokens: 0,
    ...overrides,
  };
}

describe('replyTemplate', () => {
  // ==================== renderStart ====================

  describe('renderStart', () => {
    it('should return a non-empty string', () => {
      const result = renderStart();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });

  // ==================== renderLLMGenerating ====================

  describe('renderLLMGenerating', () => {
    it('should show content + pending tool call with identifier|apiName and first arg only', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            content: 'Let me search for that.',
            thinking: false,
            toolsCalling: [
              {
                apiName: 'web_search',
                arguments: '{"query":"latest news","limit":10}',
                identifier: 'builtin',
              },
            ],
          }),
        ),
      ).toBe('Let me search for that.\n\n○ **builtin·web_search**(query: "latest news")');
    });

    it('should show multiple pending tool calls on separate lines with hollow circles', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            thinking: false,
            toolsCalling: [
              { apiName: 'search', arguments: '{"q":"test"}', identifier: 'builtin' },
              {
                apiName: 'readUrl',
                arguments: '{"url":"https://example.com"}',
                identifier: 'lobe-web-browsing',
              },
            ],
          }),
        ),
      ).toBe(
        '○ **builtin·search**(q: "test")\n○ **lobe-web-browsing·readUrl**(url: "https://example.com")',
      );
    });

    it('should handle tool calls without args', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            thinking: false,
            toolsCalling: [{ apiName: 'get_time', identifier: 'builtin' }],
          }),
        ),
      ).toBe('○ **builtin·get_time**');
    });

    it('should handle tool calls with invalid JSON args gracefully', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            thinking: false,
            toolsCalling: [{ apiName: 'broken', arguments: 'not json', identifier: 'plugin' }],
          }),
        ),
      ).toBe('○ **plugin·broken**');
    });

    it('should omit identifier when empty', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            thinking: false,
            toolsCalling: [{ apiName: 'search', arguments: '{"q":"test"}', identifier: '' }],
          }),
        ),
      ).toBe('○ **search**(q: "test")');
    });

    it('should fall back to lastContent when no content', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            lastContent: 'Previous response',
            thinking: false,
            toolsCalling: [{ apiName: 'search', identifier: 'builtin' }],
          }),
        ),
      ).toBe('Previous response\n\n○ **builtin·search**');
    });

    it('should show thinking when only reasoning present', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            reasoning: 'Let me think about this...',
            thinking: false,
          }),
        ),
      ).toBe(`${emoji.thinking} Let me think about this...`);
    });

    it('should show content with processing when pure text', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            content: 'Here is my response',
            thinking: false,
          }),
        ),
      ).toBe(`Here is my response\n\n`);
    });

    it('should show processing fallback when no content at all', () => {
      expect(renderLLMGenerating(makeParams({ thinking: false }))).toBe(
        `${emoji.thinking} Processing...`,
      );
    });
  });

  // ==================== renderToolExecuting ====================

  describe('renderToolExecuting', () => {
    it('should show completed tools with filled circle and result', () => {
      expect(
        renderToolExecuting(
          makeParams({
            lastContent: 'I will search for that.',
            lastToolsCalling: [
              { apiName: 'web_search', arguments: '{"query":"test"}', identifier: 'builtin' },
            ],
            stepType: 'call_tool',
            toolsResult: [
              { apiName: 'web_search', identifier: 'builtin', output: 'Found 3 results' },
            ],
          }),
        ),
      ).toBe(
        `I will search for that.\n\n⏺ **builtin·web_search**(query: "test")\n  ⎿  Found 3 results\n\n${emoji.thinking} Processing...`,
      );
    });

    it('should show completed tools without result when output is empty', () => {
      expect(
        renderToolExecuting(
          makeParams({
            lastToolsCalling: [{ apiName: 'get_time', identifier: 'builtin' }],
            stepType: 'call_tool',
            toolsResult: [{ apiName: 'get_time', identifier: 'builtin' }],
          }),
        ),
      ).toBe(`⏺ **builtin·get_time**\n\n${emoji.thinking} Processing...`);
    });

    it('should show multiple completed tools with results', () => {
      expect(
        renderToolExecuting(
          makeParams({
            lastToolsCalling: [
              { apiName: 'search', arguments: '{"q":"test"}', identifier: 'builtin' },
              {
                apiName: 'readUrl',
                arguments: '{"url":"https://example.com"}',
                identifier: 'lobe-web-browsing',
              },
            ],
            stepType: 'call_tool',
            toolsResult: [
              { apiName: 'search', identifier: 'builtin', output: 'Found 5 results' },
              {
                apiName: 'readUrl',
                identifier: 'lobe-web-browsing',
                output: 'Page loaded successfully',
              },
            ],
          }),
        ),
      ).toBe(
        `⏺ **builtin·search**(q: "test")\n  ⎿  Found 5 results\n⏺ **lobe-web-browsing·readUrl**(url: "https://example.com")\n  ⎿  Page loaded successfully\n\n${emoji.thinking} Processing...`,
      );
    });

    it('should show lastContent with processing when no lastToolsCalling', () => {
      expect(
        renderToolExecuting(
          makeParams({
            lastContent: 'I found some results.',
            stepType: 'call_tool',
          }),
        ),
      ).toBe(`I found some results.\n\n${emoji.thinking} Processing...`);
    });

    it('should show processing fallback when no lastContent and no tools', () => {
      expect(renderToolExecuting(makeParams({ stepType: 'call_tool' }))).toBe(
        `${emoji.thinking} Processing...`,
      );
    });
  });

  // ==================== summarizeOutput ====================

  describe('summarizeOutput', () => {
    it('should return undefined for empty output', () => {
      expect(summarizeOutput(undefined)).toBeUndefined();
      expect(summarizeOutput('')).toBeUndefined();
    });

    it('should return first line for single-line output', () => {
      expect(summarizeOutput('Hello world')).toBe('Hello world');
    });

    it('should truncate long first line', () => {
      const long = 'a'.repeat(120);
      expect(summarizeOutput(long)).toBe('a'.repeat(100) + '...');
    });

    it('should show line count for multi-line output', () => {
      expect(summarizeOutput('line1\nline2\nline3')).toBe('line1 … +2 lines');
    });

    it('should skip blank lines', () => {
      expect(summarizeOutput('line1\n\n\nline2')).toBe('line1 … +1 lines');
    });
  });

  // ==================== formatTokens ====================

  describe('formatTokens', () => {
    it('should return raw number for < 1000', () => {
      expect(formatTokens(0)).toBe('0');
      expect(formatTokens(999)).toBe('999');
    });

    it('should format thousands as k', () => {
      expect(formatTokens(1000)).toBe('1.0k');
      expect(formatTokens(1234)).toBe('1.2k');
      expect(formatTokens(20_400)).toBe('20.4k');
      expect(formatTokens(999_999)).toBe('1000.0k');
    });

    it('should format millions as m', () => {
      expect(formatTokens(1_000_000)).toBe('1.0m');
      expect(formatTokens(1_234_567)).toBe('1.2m');
      expect(formatTokens(12_500_000)).toBe('12.5m');
    });
  });

  // ==================== renderFinalReply ====================

  describe('renderFinalReply', () => {
    it('should append usage footer with tokens, cost, and call counts', () => {
      expect(
        renderFinalReply('Here is the answer.', {
          llmCalls: 5,
          toolCalls: 4,
          totalCost: 0.0312,
          totalTokens: 1234,
        }),
      ).toBe('Here is the answer.\n\n-# 1.2k tokens · $0.0312 | llm×5 | tools×4');
    });

    it('should hide call counts when llmCalls=1 and toolCalls=0', () => {
      expect(
        renderFinalReply('Simple answer.', {
          llmCalls: 1,
          toolCalls: 0,
          totalCost: 0.001,
          totalTokens: 500,
        }),
      ).toBe('Simple answer.\n\n-# 500 tokens · $0.0010');
    });

    it('should show call counts when toolCalls > 0 even if llmCalls=1', () => {
      expect(
        renderFinalReply('Answer.', {
          llmCalls: 1,
          toolCalls: 2,
          totalCost: 0.005,
          totalTokens: 800,
        }),
      ).toBe('Answer.\n\n-# 800 tokens · $0.0050 | llm×1 | tools×2');
    });

    it('should show call counts when llmCalls > 1 even if toolCalls=0', () => {
      expect(
        renderFinalReply('Answer.', {
          llmCalls: 3,
          toolCalls: 0,
          totalCost: 0.01,
          totalTokens: 2000,
        }),
      ).toBe('Answer.\n\n-# 2.0k tokens · $0.0100 | llm×3 | tools×0');
    });

    it('should hide call counts for zero usage', () => {
      expect(
        renderFinalReply('Done.', { llmCalls: 0, toolCalls: 0, totalCost: 0, totalTokens: 0 }),
      ).toBe('Done.\n\n-# 0 tokens · $0.0000');
    });

    it('should format large token counts', () => {
      expect(
        renderFinalReply('Result', {
          llmCalls: 10,
          toolCalls: 20,
          totalCost: 1.5,
          totalTokens: 1_234_567,
        }),
      ).toBe('Result\n\n-# 1.2m tokens · $1.5000 | llm×10 | tools×20');
    });
  });

  // ==================== renderError ====================

  describe('renderError', () => {
    it('should wrap error in markdown code block', () => {
      expect(renderError('Something went wrong')).toBe(
        '**Agent Execution Failed**\n```\nSomething went wrong\n```',
      );
    });
  });

  // ==================== renderStepProgress (dispatcher) ====================

  describe('renderStepProgress', () => {
    it('should dispatch to renderLLMGenerating for call_llm with pending tools', () => {
      expect(
        renderStepProgress(
          makeParams({
            content: 'Looking into it',
            thinking: false,
            toolsCalling: [{ apiName: 'search', arguments: '{"q":"test"}', identifier: 'builtin' }],
          }),
        ),
      ).toBe('Looking into it\n\n○ **builtin·search**(q: "test")');
    });

    it('should dispatch to renderToolExecuting for call_tool with completed tools', () => {
      expect(
        renderStepProgress(
          makeParams({
            lastContent: 'Previous content',
            lastToolsCalling: [
              { apiName: 'search', arguments: '{"q":"test"}', identifier: 'builtin' },
            ],
            stepType: 'call_tool',
            thinking: true,
            toolsResult: [{ apiName: 'search', identifier: 'builtin', output: 'Found results' }],
          }),
        ),
      ).toBe(
        `Previous content\n\n⏺ **builtin·search**(q: "test")\n  ⎿  Found results\n\n${emoji.thinking} Processing...`,
      );
    });
  });

  // ==================== splitMessage ====================

  describe('splitMessage', () => {
    it('should return single chunk for short text', () => {
      expect(splitMessage('hello', 100)).toEqual(['hello']);
    });

    it('should split at paragraph boundary', () => {
      const text = 'a'.repeat(80) + '\n\n' + 'b'.repeat(80);
      expect(splitMessage(text, 100)).toEqual(['a'.repeat(80), 'b'.repeat(80)]);
    });

    it('should split at line boundary when no paragraph break fits', () => {
      const text = 'a'.repeat(80) + '\n' + 'b'.repeat(80);
      expect(splitMessage(text, 100)).toEqual(['a'.repeat(80), 'b'.repeat(80)]);
    });

    it('should hard-cut when no break found', () => {
      const text = 'a'.repeat(250);
      const chunks = splitMessage(text, 100);
      expect(chunks).toEqual(['a'.repeat(100), 'a'.repeat(100), 'a'.repeat(50)]);
    });

    it('should handle multiple chunks', () => {
      const text = 'chunk1\n\nchunk2\n\nchunk3';
      expect(splitMessage(text, 10)).toEqual(['chunk1', 'chunk2', 'chunk3']);
    });
  });
});
