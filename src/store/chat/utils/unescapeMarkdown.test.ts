import { describe, expect, it } from 'vitest';

import { unescapeMarkdown } from './unescapeMarkdown';

describe('unescapeMarkdown', () => {
  it('unescapes underscores in plain text', () => {
    expect(unescapeMarkdown('CLAUDE\\_CODE\\_ATTRIBUTION\\_HEADER')).toBe(
      'CLAUDE_CODE_ATTRIBUTION_HEADER',
    );
  });

  it('unescapes other markdown special chars', () => {
    expect(unescapeMarkdown('\\*bold\\*')).toBe('*bold*');
    expect(unescapeMarkdown('\\[link\\]')).toBe('[link]');
    expect(unescapeMarkdown('\\#heading')).toBe('#heading');
  });

  it('preserves backslashes inside inline code spans', () => {
    expect(unescapeMarkdown('`FOO\\_BAR`')).toBe('`FOO\\_BAR`');
  });

  it('preserves backslashes inside fenced code blocks', () => {
    const input = '```\nFOO\\_BAR\n```';
    expect(unescapeMarkdown(input)).toBe(input);
  });

  it('unescapes outside code spans but not inside', () => {
    expect(unescapeMarkdown('CLAUDE\\_CODE and `FOO\\_BAR`')).toBe('CLAUDE_CODE and `FOO\\_BAR`');
  });

  it('leaves plain text without escapes unchanged', () => {
    expect(unescapeMarkdown('hello world')).toBe('hello world');
  });

  it('preserves actual markdown formatting markers', () => {
    expect(unescapeMarkdown('**bold** and *italic*')).toBe('**bold** and *italic*');
  });
});
