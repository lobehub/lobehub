import { describe, expect, it } from 'vitest';

import { getFreeCopyName, validateFileName } from './fileNameValidation';

const siblings = [
  { isDirectory: false, name: 'index.ts' },
  { isDirectory: true, name: 'src' },
];

const create = (name: string, caseInsensitive = false) =>
  validateFileName({ allowNested: true, caseInsensitive, name, siblings });
const rename = (name: string, currentName = 'index.ts', caseInsensitive = false) =>
  validateFileName({ allowNested: false, caseInsensitive, currentName, name, siblings });

describe('validateFileName', () => {
  it('accepts ordinary names and dotfiles', () => {
    expect(create('notes.md')).toBeNull();
    expect(create('.env.local')).toBeNull();
    expect(rename('main.ts')).toBeNull();
  });

  it('rejects empty and whitespace-only names', () => {
    expect(create('')).toBe('empty');
    expect(create('   ')).toBe('empty');
    expect(rename('')).toBe('empty');
  });

  it('rejects leading or trailing spaces instead of trimming them silently', () => {
    expect(create(' notes.md')).toBe('whitespace');
    expect(rename('main.ts ')).toBe('whitespace');
  });

  it('rejects the reserved . and .. names, also as a nested segment', () => {
    expect(create('.')).toBe('reserved');
    expect(rename('..')).toBe('reserved');
    expect(create('a/../b.ts')).toBe('reserved');
  });

  it('rejects characters the file host refuses', () => {
    for (const name of ['a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b', 'a\\b', 'a\u0001b']) {
      expect(create(name)).toBe('invalidChars');
    }
  });

  it('lets a new entry name a nested path but never a rename', () => {
    expect(create('docs/guide/intro.md')).toBeNull();
    expect(rename('docs/intro.md')).toBe('invalidChars');
    expect(create('docs//intro.md')).toBe('empty');
    expect(create('docs/')).toBe('empty');
  });

  it('rejects names over 255 UTF-8 bytes', () => {
    expect(create('a'.repeat(255))).toBeNull();
    expect(create('a'.repeat(256))).toBe('tooLong');
    // 86 × 3-byte characters = 258 bytes
    expect(create('文'.repeat(86))).toBe('tooLong');
  });

  it('rejects a name already taken in the folder', () => {
    expect(create('index.ts')).toBe('exists');
    expect(create('src')).toBe('exists');
    expect(rename('src')).toBe('exists');
  });

  it('compares case-insensitively only where the file system does', () => {
    expect(create('INDEX.ts', false)).toBeNull();
    expect(create('INDEX.ts', true)).toBe('exists');
  });

  it('treats the current name and a case-only rename as no clash', () => {
    expect(rename('index.ts')).toBeNull();
    expect(rename('Index.ts', 'index.ts', true)).toBeNull();
  });

  it('allows a nested new entry inside an existing folder but not through a file', () => {
    expect(create('src/new.ts')).toBeNull();
    expect(create('index.ts/new.ts')).toBe('exists');
  });
});

describe('getFreeCopyName', () => {
  it('keeps the name when it is free', () => {
    expect(getFreeCopyName('a.ts', false, siblings, false)).toBe('a.ts');
  });

  it('numbers copies Finder-style, before the extension', () => {
    expect(getFreeCopyName('index.ts', false, siblings, false)).toBe('index copy.ts');
    expect(
      getFreeCopyName(
        'index.ts',
        false,
        [...siblings, { isDirectory: false, name: 'index copy.ts' }],
        false,
      ),
    ).toBe('index copy 2.ts');
  });

  it('never splits a folder name at a dot', () => {
    expect(getFreeCopyName('v1.2', true, [{ isDirectory: true, name: 'v1.2' }], false)).toBe(
      'v1.2 copy',
    );
  });
});
