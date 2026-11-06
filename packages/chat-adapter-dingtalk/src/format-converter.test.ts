import { describe, expect, it } from 'vitest';

import { DingTalkFormatConverter } from './format-converter';

const converter = new DingTalkFormatConverter();

describe('DingTalkFormatConverter', () => {
  it('derives the title from link text and picks markdown for link syntax', () => {
    expect(converter.deriveTitle('[Docs](https://example.com) for you')).toBe('Docs for you');
    expect(converter.toOutboundMessage('see [a](https://x.y)', 'see [a](https://x.y)').msgKey).toBe(
      'sampleMarkdown',
    );
    expect(converter.toOutboundMessage('plain [text] (here)', 'plain [text] (here)').msgKey).toBe(
      'sampleText',
    );
  });

  // Unclosed brackets / parens must not make the link patterns rescan the rest of
  // the line from every start position (polynomial ReDoS on agent output).
  it.each([
    ['unclosed brackets', '['.repeat(50_000)],
    ['unclosed link targets', '[]('.repeat(50_000)],
  ])('handles %s in linear time', (_, text) => {
    const started = performance.now();
    converter.deriveTitle(text);
    converter.toOutboundMessage(text, text);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
