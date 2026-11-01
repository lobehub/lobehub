import { describe, expect, it } from 'vitest';

import { sanitizeAnthropicThinkingParts } from './sanitizeAnthropicThinkingParts';

describe('sanitizeAnthropicThinkingParts', () => {
  it('should strip signatures from thinking parts while keeping the text', () => {
    const result = sanitizeAnthropicThinkingParts([
      { signature: 'claude-base64-signature', thinking: 'let me think', type: 'thinking' },
      { text: 'answer', type: 'text' },
    ]);

    expect(result).toEqual([
      { thinking: 'let me think', type: 'thinking' },
      { text: 'answer', type: 'text' },
    ]);
  });

  it('should drop signature-only thinking parts missing the thinking field', () => {
    // Claude 5 `thinking.display: 'omitted'` history: `thinking: undefined` is
    // dropped by JSON serialization, so DeepSeek rejects the part with
    // 400 `missing field 'thinking'` — the whole part must be removed.
    const result = sanitizeAnthropicThinkingParts([
      { signature: 'signature-only', type: 'thinking' },
      { text: 'answer', type: 'text' },
    ]);

    expect(result).toEqual([{ text: 'answer', type: 'text' }]);
  });

  it('should drop thinking parts with empty-string thinking', () => {
    const result = sanitizeAnthropicThinkingParts([
      { signature: 'sig', thinking: '', type: 'thinking' },
      { text: 'answer', type: 'text' },
    ]);

    expect(result).toEqual([{ text: 'answer', type: 'text' }]);
  });

  it('should keep the single-space placeholder thinking part', () => {
    const result = sanitizeAnthropicThinkingParts([{ thinking: ' ', type: 'thinking' }]);

    expect(result).toEqual([{ thinking: ' ', type: 'thinking' }]);
  });

  it('should drop redacted_thinking parts', () => {
    const result = sanitizeAnthropicThinkingParts([
      { data: 'encrypted', type: 'redacted_thinking' },
      { text: 'answer', type: 'text' },
    ]);

    expect(result).toEqual([{ text: 'answer', type: 'text' }]);
  });

  it('should pass through non-thinking parts untouched', () => {
    const parts = [
      { text: 'hello', type: 'text' },
      { id: 'toolu_1', input: {}, name: 'search', type: 'tool_use' },
    ];

    expect(sanitizeAnthropicThinkingParts(parts)).toEqual(parts);
  });
});
