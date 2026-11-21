import { describe, expect, it } from 'vitest';

import { dequoteGitPath, quoteGitPath } from './workingTree';

describe('UTF-8 in Git quoted paths', () => {
  it.each(['中文.txt', 'café.md', '😀.json'])('decodes octal bytes for %s', (filename) => {
    const quotedBytes = [...Buffer.from(filename)]
      .map((byte) => `\\${byte.toString(8).padStart(3, '0')}`)
      .join('');
    expect(dequoteGitPath(quotedBytes)).toBe(filename);
  });

  it('keeps literal backslashes separate from encoded byte sequences', () => {
    expect(dequoteGitPath('literal\\\\303.txt')).toBe('literal\\303.txt');
    const filename = '目录/line\n😀.txt';
    expect(dequoteGitPath(quoteGitPath('b/', filename).slice(1, -1))).toBe(`b/${filename}`);
  });
});
