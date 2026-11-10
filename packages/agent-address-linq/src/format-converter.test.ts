import { describe, expect, it } from 'vitest';

import { markdownToPlainText } from './format-converter';

describe('markdownToPlainText', () => {
  it('strips markdown markers because Linq delivers text parts verbatim', () => {
    const plain = markdownToPlainText('**bold** and *italic* and `code`');

    expect(plain).toContain('bold');
    expect(plain).toContain('italic');
    expect(plain).toContain('code');
    expect(plain).not.toContain('**');
    expect(plain).not.toContain('`');
  });

  it('keeps link targets reachable as text', () => {
    const plain = markdownToPlainText('See [the docs](https://lobehub.com/docs).');

    expect(plain).toContain('https://lobehub.com/docs');
    expect(plain).not.toContain('](');
  });

  it('drops heading markers but keeps the heading text', () => {
    const plain = markdownToPlainText('## Daily brief\n\n- item one\n- item two');

    expect(plain).toContain('Daily brief');
    expect(plain).not.toContain('##');
    expect(plain).toContain('item one');
  });

  it('leaves already-plain text untouched', () => {
    expect(markdownToPlainText('  plain text  ')).toBe('plain text');
  });
});
