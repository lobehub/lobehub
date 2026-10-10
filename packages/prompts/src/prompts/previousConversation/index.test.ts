import { describe, expect, it } from 'vitest';

import { formatPreviousConversation } from './index';

describe('formatPreviousConversation', () => {
  it('returns undefined without turns', () => {
    expect(formatPreviousConversation([])).toBeUndefined();
  });

  it('truncates user turns at 1 KB and assistant turns at 2 KB', () => {
    const result = formatPreviousConversation([
      { content: 'u'.repeat(1100), role: 'user' },
      { content: 'a'.repeat(2100), role: 'assistant' },
    ])!;

    expect(result).toContain(`<user>\n${'u'.repeat(1024)}… [truncated]\n</user>`);
    expect(result).toContain(`<assistant>\n${'a'.repeat(2048)}… [truncated]\n</assistant>`);
  });

  it('keeps the newest turns within the total budget', () => {
    const result = formatPreviousConversation(
      [
        { content: 'OLDEST', role: 'user' },
        { content: 'MIDDLE', role: 'assistant' },
        { content: 'NEWEST', role: 'user' },
      ],
      { maxTotalChars: 60 },
    )!;

    expect(result).not.toContain('OLDEST');
    expect(result).toContain('MIDDLE');
    expect(result).toContain('NEWEST');
    expect(result).toContain('[1 earlier turns omitted]');
  });
});
