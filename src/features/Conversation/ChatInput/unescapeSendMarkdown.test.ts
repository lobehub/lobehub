import { describe, expect, it } from 'vitest';

import { unescapeMarkdown } from '@/store/chat/utils/unescapeMarkdown';

describe('chat input send markdown normalization', () => {
  it('unescapes markdown-only escapes before sending plain text', () => {
    expect(unescapeMarkdown('D:\\godot\\_mcp')).toBe('D:\\godot_mcp');
    expect(unescapeMarkdown('A\\_i = k')).toBe('A_i = k');
  });

  it('keeps escapes inside inline code and fenced code blocks', () => {
    expect(unescapeMarkdown('`D:\\godot\\_mcp`')).toBe('`D:\\godot\\_mcp`');
    expect(unescapeMarkdown('```\nD:\\godot\\_mcp\n```')).toBe('```\nD:\\godot\\_mcp\n```');
  });
});
