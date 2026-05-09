import { describe, expect, it, vi } from 'vitest';

import { dequoteGitPath, quoteGitPath } from '../GitCtr';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('quoteGitPath', () => {
  it('leaves plain ASCII paths unquoted (including spaces)', () => {
    expect(quoteGitPath('a/', 'src/foo.ts')).toBe('a/src/foo.ts');
    expect(quoteGitPath('b/', 'src/foo bar.ts')).toBe('b/src/foo bar.ts');
    expect(quoteGitPath('a/', 'with-dash_and.underscore')).toBe('a/with-dash_and.underscore');
  });

  it('C-style escapes TAB / LF / CR / quote / backslash', () => {
    expect(quoteGitPath('b/', 'with\ttab.txt')).toBe('"b/with\\ttab.txt"');
    expect(quoteGitPath('b/', 'with\nlf.txt')).toBe('"b/with\\nlf.txt"');
    expect(quoteGitPath('b/', 'with\rcr.txt')).toBe('"b/with\\rcr.txt"');
    expect(quoteGitPath('b/', 'with"quote.txt')).toBe('"b/with\\"quote.txt"');
    expect(quoteGitPath('b/', 'with\\backslash.txt')).toBe('"b/with\\\\backslash.txt"');
  });

  it('octal-escapes other control bytes (NUL, 0x1F, DEL)', () => {
    expect(quoteGitPath('a/', 'nul\x00here')).toBe('"a/nul\\000here"');
    expect(quoteGitPath('a/', 'unit\x1Fsep')).toBe('"a/unit\\037sep"');
    expect(quoteGitPath('a/', 'del\x7Fchar')).toBe('"a/del\\177char"');
  });

  it('puts the prefix inside the quotes', () => {
    // Real git output for `git diff` of a tab-containing file:
    //   diff --git "a/with\there" "b/with\there"
    expect(quoteGitPath('a/', 'with\there')).toBe('"a/with\\there"');
    expect(quoteGitPath('b/', 'with\there')).toBe('"b/with\\there"');
  });

  it('round-trips through dequoteGitPath for problem characters', () => {
    const cases = [
      'with\ttab.txt',
      'with\nlf.txt',
      'with\rcr.txt',
      'with"quote.txt',
      'with\\backslash.txt',
      'nul\x00inside',
      'mix\t"of\\everything\n',
    ];
    for (const original of cases) {
      const quoted = quoteGitPath('b/', original);
      // Strip the surrounding quotes + b/ prefix, then de-escape.
      expect(quoted.startsWith('"b/')).toBe(true);
      expect(quoted.endsWith('"')).toBe(true);
      const stripped = quoted.slice(1, -1).slice('b/'.length);
      expect(dequoteGitPath(stripped)).toBe(original);
    }
  });
});

describe('dequoteGitPath', () => {
  it('decodes named C-style escapes', () => {
    expect(dequoteGitPath('with\\ttab')).toBe('with\ttab');
    expect(dequoteGitPath('with\\nlf')).toBe('with\nlf');
    expect(dequoteGitPath('with\\rcr')).toBe('with\rcr');
    expect(dequoteGitPath('with\\"quote')).toBe('with"quote');
    expect(dequoteGitPath('with\\\\bs')).toBe('with\\bs');
  });

  it('decodes 3-digit octal escapes', () => {
    expect(dequoteGitPath('nul\\000here')).toBe('nul\x00here');
    expect(dequoteGitPath('unit\\037sep')).toBe('unit\x1Fsep');
    expect(dequoteGitPath('del\\177char')).toBe('del\x7Fchar');
  });

  it('leaves unescaped chars alone', () => {
    expect(dequoteGitPath('plain ascii here')).toBe('plain ascii here');
  });
});
