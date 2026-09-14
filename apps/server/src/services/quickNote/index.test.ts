import { describe, expect, it } from 'vitest';

import { parseQuickNoteAnalyzeOutput, renderQuickNoteSourceText } from '.';

/** @example Quick Note agent boundaries normalize rich-text input and structured output. */
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

  /** @example Analyze accepts a fenced JSON result produced by a chat model. */
  it('parses and bounds Analyze output', () => {
    const parsed = parseQuickNoteAnalyzeOutput(
      '```json\n{"annotation":"Useful","tags":["one","two","three","four","five","six"],"contextQueries":[" voice ","audio%","voice","_"],"relatedResources":[{"type":"topic","id":"tpc_1","selector":{"quote":"duplex"}},{"type":"topic","id":"tpc_1"},{"type":"document","id":"docs_1","selector":"invalid"},{"type":"invalid","id":"bad"}],"proposals":[{"kind":"task","content":"Review the experiment"},{"kind":"page","content":"Invalid kind"}]}\n```',
    );

    /** @example Only the five lightweight tags allowed by the agent contract survive. */
    expect(parsed).toEqual({
      annotation: 'Useful',
      contextQueries: ['voice', 'audio'],
      proposals: [{ content: 'Review the experiment', kind: 'task' }],
      relatedResources: [
        { id: 'tpc_1', selector: { quote: 'duplex' }, type: 'topic' },
        { id: 'docs_1', type: 'document' },
      ],
      tags: ['one', 'two', 'three', 'four', 'five'],
    });
  });
});
