import { describe, expect, it } from 'vitest';

import { buildQuickNoteDiveInstruction, renderQuickNoteSourceText } from '.';

/** @example Quick Note agent boundaries normalize rich-text input. */
describe('QuickNoteProcessingService helpers', () => {
  /** @example Lexical text nodes become a compact source string for an immutable Run prompt. */
  it('renders nested editor text without leaking structural JSON', () => {
    const rendered = renderQuickNoteSourceText({
      root: { children: [{ children: [{ text: 'Second' }], text: 'First' }] },
    });

    /** @example Human-readable text is preserved in traversal order. */
    expect(rendered).toBe('First\nSecond');
  });

  /** @example Markdown-backed Document revisions retain their source text. */
  it('renders a Markdown editor projection', () => {
    /** @example The fallback format becomes the exact prompt source. */
    expect(renderQuickNoteSourceText({ markdown: 'Remember this' })).toBe('Remember this');
  });

  /** @example A Dive brief carries the note and its comments verbatim. */
  it('builds a self-contained Dive brief', () => {
    const brief = buildQuickNoteDiveInstruction('调研 moshi', ['focus on latency']);

    expect(brief).toContain('<quick_note>\n调研 moshi\n</quick_note>');
    expect(brief).toContain('- focus on latency');
    expect(buildQuickNoteDiveInstruction('x', [])).not.toContain('quick_note_comments');
  });
});
