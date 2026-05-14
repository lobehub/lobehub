import { describe, expect, it } from 'vitest';

import type { RenderStepParams } from '../replyTemplate';
import {
  formatTokens,
  renderAgentError,
  renderCommandReply,
  renderDmRejected,
  renderError,
  renderErrorWithDetails,
  renderFinalReply,
  renderGroupRejected,
  renderInlineError,
  renderLLMGenerating,
  renderSenderRejected,
  renderStart,
  renderStepProgress,
  renderStopped,
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
      ).toBe(`💭 Let me think about this...`);
    });

    it('should show content with processing when pure text', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            content: 'Here is my response',
            thinking: false,
          }),
        ),
      ).toBe(`Here is my response`);
    });

    it('should show processing fallback when no content at all', () => {
      expect(renderLLMGenerating(makeParams({ thinking: false }))).toBe(`💭 Processing...`);
    });

    it('should trim leading/trailing newlines from content to prevent extra blank lines', () => {
      expect(
        renderLLMGenerating(
          makeParams({
            content: '\n\nHere is my response\n\n',
            thinking: false,
            toolsCalling: [{ apiName: 'search', arguments: '{"q":"test"}', identifier: 'builtin' }],
          }),
        ),
      ).toBe('Here is my response\n\n○ **builtin·search**(q: "test")');
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
        `I will search for that.\n\n⏺ **builtin·web_search**(query: "test")\n⎿  success: 15 chars\n\n💭 Processing...`,
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
      ).toBe(`⏺ **builtin·get_time**\n\n💭 Processing...`);
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
        `⏺ **builtin·search**(q: "test")\n⎿  success: 15 chars\n⏺ **lobe-web-browsing·readUrl**(url: "https://example.com")\n⎿  success: 24 chars\n\n💭 Processing...`,
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
      ).toBe(`I found some results.\n\n💭 Processing...`);
    });

    it('should show processing fallback when no lastContent and no tools', () => {
      expect(renderToolExecuting(makeParams({ stepType: 'call_tool' }))).toBe(`💭 Processing...`);
    });

    it('should trim leading/trailing newlines from lastContent to prevent extra blank lines', () => {
      expect(
        renderToolExecuting(
          makeParams({
            lastContent: '\n\nI will search for that.\n\n',
            lastToolsCalling: [
              { apiName: 'search', arguments: '{"q":"test"}', identifier: 'builtin' },
            ],
            stepType: 'call_tool',
            toolsResult: [{ apiName: 'search', identifier: 'builtin', output: 'Found results' }],
          }),
        ),
      ).toBe(
        `I will search for that.\n\n⏺ **builtin·search**(q: "test")\n⎿  success: 13 chars\n\n💭 Processing...`,
      );
    });
  });

  // ==================== summarizeOutput ====================

  describe('summarizeOutput', () => {
    it('should return undefined for empty output', () => {
      expect(summarizeOutput(undefined)).toBeUndefined();
      expect(summarizeOutput('')).toBeUndefined();
      expect(summarizeOutput('   ')).toBeUndefined();
    });

    it('should show char count for output', () => {
      expect(summarizeOutput('Hello world')).toBe('success: 11 chars');
    });

    it('should show char count for long output', () => {
      const long = 'a'.repeat(5000);
      expect(summarizeOutput(long)).toContain('5,000 chars');
    });

    it('should show char count for multi-line output', () => {
      expect(summarizeOutput('line1\nline2\nline3')).toBe('success: 17 chars');
    });

    it('should show error status when isSuccess is false', () => {
      expect(summarizeOutput('Something went wrong', false)).toBe('error: 20 chars');
    });

    it('should show success status when isSuccess is true', () => {
      expect(summarizeOutput('All good', true)).toBe('success: 8 chars');
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
    it('should return content body only (no stats)', () => {
      expect(renderFinalReply('Here is the answer.')).toBe('Here is the answer.');
    });

    it('should trim trailing whitespace', () => {
      expect(renderFinalReply('Answer.  \n\n')).toBe('Answer.');
    });
  });

  // ==================== renderError ====================

  describe('renderError', () => {
    it('should include the operation id when provided', () => {
      expect(renderError('op-abc-123')).toBe(
        '**Agent Execution Failed**\nOperation ID: `op-abc-123`',
      );
    });

    it('should fall back to a generic header when no operation id is provided', () => {
      expect(renderError()).toBe('**Agent Execution Failed**');
    });

    it('renders Chinese copy when locale is zh-CN', () => {
      expect(renderError(undefined, 'zh-CN')).toBe('**Agent 执行失败**');
      expect(renderError('op-1', 'zh-CN')).toContain('Agent 执行失败');
      expect(renderError('op-1', 'zh-CN')).toContain('op-1');
    });

    it('falls back to English for locales without a translated dictionary', () => {
      expect(renderError(undefined, 'ja-JP')).toBe('**Agent Execution Failed**');
    });
  });

  // ==================== renderAgentError ====================

  describe('renderAgentError', () => {
    it('returns the friendly NoAvailableProvider copy and appends the operation id footer', () => {
      const out = renderAgentError('NoAvailableProvider', undefined, 'op-abc');
      expect(out).toContain('No model provider configured');
      // The friendly message guides the user; the op id is appended as a
      // traceable footer so operators can still find the failure in logs.
      expect(out).toContain('op-abc');
    });

    it('renders Chinese NoAvailableProvider copy with operation id footer when locale is zh-CN', () => {
      const out = renderAgentError('NoAvailableProvider', undefined, 'op-abc', 'zh-CN');
      expect(out).toContain('未配置可用的模型 Provider');
      expect(out).toContain('op-abc');
    });

    it('omits the operation id footer when none is provided', () => {
      const out = renderAgentError('NoAvailableProvider', undefined, undefined);
      expect(out).toContain('No model provider configured');
      expect(out).not.toContain('Operation ID');
    });

    it('returns the friendly InvalidProviderAPIKey copy', () => {
      const en = renderAgentError('InvalidProviderAPIKey', undefined, 'op-1');
      expect(en).toContain('Invalid or missing API key');
      const zh = renderAgentError('InvalidProviderAPIKey', undefined, 'op-1', 'zh-CN');
      expect(zh).toContain('API Key 无效');
    });

    it('returns the friendly ExceededContextWindow copy', () => {
      expect(renderAgentError('ExceededContextWindow', undefined, 'op-1')).toContain(
        'Context window exceeded',
      );
      expect(renderAgentError('ExceededContextWindow', undefined, 'op-1', 'zh-CN')).toContain(
        '上下文已超出',
      );
    });

    it('maps both QuotaLimitReached and InsufficientQuota to the same quota copy', () => {
      const a = renderAgentError('QuotaLimitReached', undefined, 'op-1');
      const b = renderAgentError('InsufficientQuota', undefined, 'op-1');
      expect(a).toContain('quota');
      expect(b).toContain('quota');
      expect(a).toBe(b);
    });

    it('uses friendly copy for command connection close failures wrapped as 500 errors', () => {
      const en = renderAgentError('500', 'Command aborted due to connection close', 'op-1');
      expect(en).toContain('Command session disconnected');
      expect(en).toContain('op-1');

      const zh = renderAgentError(
        '500',
        'Command aborted due to connection close',
        'op-1',
        'zh-CN',
      );
      expect(zh).toContain('命令会话已断开');
    });

    it('falls back to the generic op-id template for unknown error codes', () => {
      expect(renderAgentError('SomeNewErrorCode', undefined, 'op-1')).toBe(
        '**Agent Execution Failed**\nOperation ID: `op-1`',
      );
    });

    it('falls back to the generic header when neither errorType nor operationId is known', () => {
      expect(renderAgentError(undefined, undefined, undefined)).toBe('**Agent Execution Failed**');
    });
  });

  // ==================== renderStopped ====================

  describe('renderStopped', () => {
    it('returns the default English message when no message is supplied', () => {
      expect(renderStopped()).toBe('Execution stopped.');
    });

    it('returns the default Chinese message when locale is zh-CN', () => {
      expect(renderStopped(undefined, 'zh-CN')).toBe('执行已停止。');
    });

    it('passes through an explicit message regardless of locale', () => {
      expect(renderStopped('Stopped by user.', 'zh-CN')).toBe('Stopped by user.');
    });
  });

  // ==================== renderDmRejected ====================

  describe('renderDmRejected', () => {
    it('renders disabled and allowlist English copy', () => {
      expect(renderDmRejected('disabled')).toContain("isn't accepting direct messages");
      expect(renderDmRejected('allowlist')).toContain("aren't authorized");
    });

    it('renders disabled and allowlist Chinese copy when locale is zh-CN', () => {
      expect(renderDmRejected('disabled', 'zh-CN')).toContain('不接受私信');
      expect(renderDmRejected('allowlist', 'zh-CN')).toContain('没有私信该机器人的权限');
    });
  });

  // ==================== renderGroupRejected ====================

  describe('renderGroupRejected', () => {
    it('renders disabled and allowlist English copy', () => {
      expect(renderGroupRejected('disabled')).toContain("doesn't respond in groups or channels");
      expect(renderGroupRejected('allowlist')).toContain("isn't enabled in this channel");
    });

    it('renders disabled and allowlist Chinese copy when locale is zh-CN', () => {
      expect(renderGroupRejected('disabled', 'zh-CN')).toContain('不在群组或频道中响应');
      expect(renderGroupRejected('allowlist', 'zh-CN')).toContain('未在此频道启用');
    });
  });

  // ==================== renderSenderRejected ====================

  describe('renderSenderRejected', () => {
    it("uses generic 'interact with this bot' phrasing — never 'direct messages'", () => {
      // The notice is shown out-of-band when a user @-mentioned in a
      // group; saying "you aren't authorized to send direct messages"
      // would misdescribe what the user actually did.
      const en = renderSenderRejected();
      expect(en).toContain("aren't authorized");
      expect(en).toContain('interact with this bot');
      expect(en).not.toContain('direct messages');
    });

    it('renders Chinese copy when locale is zh-CN, also avoiding DM phrasing', () => {
      const zh = renderSenderRejected('zh-CN');
      expect(zh).toContain('交互的权限');
      expect(zh).not.toContain('私信');
    });
  });

  // ==================== renderInlineError / renderErrorWithDetails ====================

  describe('renderInlineError', () => {
    it('formats a compact **Error** line in English by default', () => {
      expect(renderInlineError('boom')).toBe('**Error**: boom');
    });

    it('uses Chinese copy when locale is zh-CN', () => {
      expect(renderInlineError('boom', 'zh-CN')).toBe('**错误**：boom');
    });
  });

  describe('renderErrorWithDetails', () => {
    it('embeds the raw detail block in English by default', () => {
      const out = renderErrorWithDetails('stack trace');
      expect(out).toContain('Agent Execution Failed');
      expect(out).toContain('Details:');
      expect(out).toContain('stack trace');
    });

    it('embeds the raw detail block with Chinese label when locale is zh-CN', () => {
      const out = renderErrorWithDetails('stack trace', 'zh-CN');
      expect(out).toContain('Agent 执行失败');
      expect(out).toContain('详细信息');
      expect(out).toContain('stack trace');
    });

    it('includes the Operation ID footer when an operationId is provided', () => {
      const en = renderErrorWithDetails('stack trace', undefined, 'op-xyz');
      expect(en).toContain('Operation ID: `op-xyz`');
      expect(en).toContain('stack trace');

      const zh = renderErrorWithDetails('stack trace', 'zh-CN', 'op-xyz');
      expect(zh).toContain('Operation ID: `op-xyz`');
      expect(zh).toContain('stack trace');
    });
  });

  // ==================== renderCommandReply ====================

  describe('renderCommandReply', () => {
    it('returns the English copy for each command key by default', () => {
      expect(renderCommandReply('cmdNewReset')).toContain('Conversation reset');
      expect(renderCommandReply('cmdStopNotActive')).toContain('No active execution');
      expect(renderCommandReply('cmdStopRequested')).toBe('Stop requested.');
      expect(renderCommandReply('cmdStopUnable')).toContain('Unable to stop');
    });

    it('returns the Chinese copy when locale is zh-CN', () => {
      expect(renderCommandReply('cmdNewReset', 'zh-CN')).toContain('对话已重置');
      expect(renderCommandReply('cmdStopNotActive', 'zh-CN')).toContain('没有正在执行');
      expect(renderCommandReply('cmdStopRequested', 'zh-CN')).toBe('已发出停止请求。');
      expect(renderCommandReply('cmdStopUnable', 'zh-CN')).toContain('无法停止');
    });
  });

  // ==================== renderStepProgress locale ====================

  describe('renderStepProgress locale', () => {
    it('uses Chinese "处理中…" placeholder in zh-CN', () => {
      const out = renderStepProgress(makeParams({ stepType: 'call_llm' }), 'zh-CN');
      expect(out).toContain('处理中…');
      expect(out).not.toContain('Processing...');
    });

    it('uses Chinese tools-calling header in zh-CN', () => {
      const out = renderStepProgress(
        makeParams({
          stepType: 'call_tool',
          totalToolCalls: 3,
          elapsedMs: 1500,
        }),
        'zh-CN',
      );
      expect(out).toContain('共 **3** 次工具调用');
    });
  });

  // ==================== renderStart locale ====================

  describe('renderStart locale', () => {
    it('returns a Chinese ack phrase when locale is zh-CN', () => {
      // The zh fallback list is small and flat — every entry is non-Latin.
      const phrase = renderStart('hi', { lng: 'zh-CN' });
      expect(/[\u4E00-\u9FFF]/.test(phrase)).toBe(true);
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
        `Previous content\n\n⏺ **builtin·search**(q: "test")\n⎿  success: 13 chars\n\n💭 Processing...`,
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

    it('should drop empty input rather than emitting a single empty chunk', () => {
      // Telegram rejects empty/whitespace-only sendMessage as
      // "message text is empty" — splitMessage must not produce one.
      expect(splitMessage('', 100)).toEqual([]);
      expect(splitMessage('   ', 100)).toEqual([]);
      expect(splitMessage('\n\n\n', 100)).toEqual([]);
    });

    it('should drop whitespace-only chunks at boundaries', () => {
      // Leading "\n\n" with a tight limit used to produce ["\n", ...] —
      // a single newline is treated as empty by Telegram.
      const chunks = splitMessage('\n\nAAAAAA', 3);
      for (const c of chunks) expect(c.trim().length).toBeGreaterThan(0);
      expect(chunks.join('')).toContain('AAA');
    });
  });
});
