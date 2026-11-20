import { describe, expect, it } from 'vitest';

import { renderTranscriptMarkdown } from './transcript-markdown';

const row = (overrides: Partial<Parameters<typeof renderTranscriptMarkdown>[1][number]>) => ({
  content: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'user',
  toolCallId: null,
  tools: null,
  ...overrides,
});

describe('renderTranscriptMarkdown', () => {
  it('keeps a multi-line title on one heading line, and only on the first page', () => {
    expect(renderTranscriptMarkdown('Line one\nline two', [], { first: true })).toBe(
      '# Line one line two\n',
    );
    expect(
      renderTranscriptMarkdown('Title', [row({ content: 'hi' })], { first: false }),
    ).not.toContain('# Title');
  });

  it('fences a tool result with more backticks than it contains', () => {
    const markdown = renderTranscriptMarkdown(
      null,
      [row({ content: 'before\n```\ninner\n```\nafter', role: 'tool', toolCallId: 'call_1' })],
      { first: false },
    );
    expect(markdown).toContain('````\nbefore\n```\ninner\n```\nafter\n````');
  });

  it('lists the tool calls an assistant message made', () => {
    const markdown = renderTranscriptMarkdown(
      null,
      [
        row({
          content: 'Looking',
          role: 'assistant',
          tools: [{ apiName: 'q', id: 'c1', identifier: 's' }],
        }),
      ],
      { first: false },
    );
    expect(markdown).toContain('## Assistant · 2026-01-01T00:00:00.000Z');
    expect(markdown).toContain('- Called `s.q` (`c1`)');
  });
});
