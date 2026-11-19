import { describe, expect, it } from 'vitest';

import { isTranscriptSwap } from './transcriptSwap';

describe('isTranscriptSwap', () => {
  it.each([
    ['first compression', ['m0', 'm1', 'u', 'a'], ['g', 'u', 'a']],
    ['failed first compression', ['g', 'u', 'a'], ['m0', 'm1', 'u', 'a']],
    [
      'later compression under an older group',
      ['g1', 'm0', 'm1', 'u', 'a'],
      ['g1', 'g2', 'u', 'a'],
    ],
    ['failed later compression', ['g1', 'g2', 'u', 'a'], ['g1', 'm0', 'm1', 'u', 'a']],
    ['a cached list replaced by another one', ['x', 'y'], ['m0', 'm1']],
  ])('detects %s', (_, prev, next) => {
    expect(isTranscriptSwap(prev, next)).toBe(true);
  });

  it.each([
    ['an appended turn', ['m0', 'm1'], ['m0', 'm1', 'u', 'a']],
    ['a prepended page', ['m0', 'm1'], ['o0', 'o1', 'm0', 'm1']],
    ['a deleted row', ['m0', 'm1', 'm2'], ['m0', 'm2']],
    ['a deleted first row', ['m0', 'm1', 'm2'], ['m1', 'm2']],
    ['optimistic ids swapped for server ids', ['m0', 'tmp_u', 'tmp_a'], ['m0', 'u', 'a']],
    ['an unchanged list', ['m0', 'm1'], ['m0', 'm1']],
    ['an empty list', [], ['m0']],
  ])('ignores %s', (_, prev, next) => {
    expect(isTranscriptSwap(prev, next)).toBe(false);
  });
});
