import { describe, expect, it } from 'vitest';

import { buildDocumentFilename, extractMarkdownH1Title, slugifyDocumentTitle } from '../filename';

describe('buildDocumentFilename', () => {
  it('returns the title as-is without appending an extension', () => {
    expect(buildDocumentFilename('Daily Brief')).toBe('Daily Brief');
  });

  it('preserves non-ASCII titles', () => {
    expect(buildDocumentFilename('Daily Brief 提取框架')).toBe('Daily Brief 提取框架');
  });

  it('replaces path separators to prevent traversal', () => {
    expect(buildDocumentFilename('foo/bar\\baz')).toBe('foo-bar-baz');
  });

  it('falls back to a default when title is empty after sanitisation', () => {
    expect(buildDocumentFilename('   ')).toBe('document');
    expect(buildDocumentFilename('')).toBe('document');
  });

  it('trims trailing dots and whitespace', () => {
    expect(buildDocumentFilename('note...  ')).toBe('note');
  });
});

describe('slugifyDocumentTitle', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyDocumentTitle('Daily Brief')).toBe('daily-brief');
  });

  it('drops non-ascii characters', () => {
    expect(slugifyDocumentTitle('提取框架 extract')).toBe('extract');
  });
});

describe('extractMarkdownH1Title', () => {
  it('extracts a leading H1 heading and strips it from content', () => {
    const result = extractMarkdownH1Title('# My Title\n\nbody line');
    expect(result).toEqual({ content: 'body line', title: 'My Title' });
  });

  it('ignores leading blank lines before the H1', () => {
    const result = extractMarkdownH1Title('\n\n# Hi\nbody');
    expect(result.title).toBe('Hi');
    expect(result.content).toBe('body');
  });

  it('returns the original content when no H1 is present', () => {
    const result = extractMarkdownH1Title('just body\n## Secondary');
    expect(result).toEqual({ content: 'just body\n## Secondary' });
  });

  it('does not treat ## headings as H1', () => {
    const result = extractMarkdownH1Title('## Not H1\nbody');
    expect(result.title).toBeUndefined();
  });

  it('handles empty H1 titles as no-op', () => {
    const result = extractMarkdownH1Title('#   \nbody');
    expect(result.title).toBeUndefined();
  });

  it('trims whitespace inside the heading', () => {
    const result = extractMarkdownH1Title('#   Spaced Title   \nbody');
    expect(result.title).toBe('Spaced Title');
  });
});
