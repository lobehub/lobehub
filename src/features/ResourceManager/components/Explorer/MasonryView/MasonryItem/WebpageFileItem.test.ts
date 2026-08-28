import { describe, expect, it } from 'vitest';

import { displayTitle, excerptOf } from './WebpageFileItem';

describe('excerptOf', () => {
  it('strips spliced html tags to a fixpoint — no <script fragment survives', () => {
    // a single-pass tag strip would turn `<scr<b>ipt>` into `<script>`
    const spliced = '<scr<b>ipt>alert(1)</scr</b>ipt> hello world';
    const result = excerptOf(spliced);
    expect(result.toLowerCase()).not.toContain('<script');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).toContain('hello world');
  });

  it('drops every angle bracket from the plain-text excerpt', () => {
    expect(excerptOf('a < b and b > c <em>text</em>')).not.toMatch(/[<>]/);
  });

  it('strips yaml frontmatter, markdown links and table rulers', () => {
    const clipping = [
      '---',
      'name: acceptance',
      'description: something',
      '---',
      '[ ](<https://example.com/>) Real content here',
      '|:---|---:|',
    ].join('\n');
    const result = excerptOf(clipping);
    expect(result).not.toContain('name: acceptance');
    expect(result).not.toContain('](');
    expect(result).not.toMatch(/-{3,}/);
    expect(result).toContain('Real content here');
  });
});

describe('displayTitle', () => {
  it('keeps a real page title unchanged', () => {
    expect(displayTitle('Agent Skills Marketplace | LobeHub')).toBe(
      'Agent Skills Marketplace | LobeHub',
    );
  });

  it('falls back to the last path segment for URL-only titles', () => {
    expect(displayTitle('https://raw.githubusercontent.com/lobehub/lobehub/main/SKILL.md')).toBe(
      'SKILL.md',
    );
  });

  it('falls back to the hostname when the URL has no path', () => {
    expect(displayTitle('https://www.example.com/')).toBe('example.com');
  });
});
