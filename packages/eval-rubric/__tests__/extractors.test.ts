import { describe, expect, it } from 'vitest';

import { extract } from '../src';

describe('extract - regex', () => {
  it('should extract with capture group', () => {
    expect(extract('The answer is B.', { type: 'regex', pattern: '([A-D])' })).toBe('B');
  });

  it('should return full match if no capture group', () => {
    expect(extract('42', { type: 'regex', pattern: '\\d+', group: 0 })).toBe('42');
  });

  it('should return original output if no match', () => {
    expect(extract('no match here', { type: 'regex', pattern: '\\d+' })).toBe('no match here');
  });
});

describe('extract - delimiter', () => {
  it('should extract after delimiter (last segment)', () => {
    expect(
      extract('Step 1... Step 2... #### 42', { type: 'delimiter', delimiter: '####' }),
    ).toBe('42');
  });

  it('should extract first segment after delimiter', () => {
    expect(
      extract('a|b|c', { type: 'delimiter', delimiter: '|', position: 'first' }),
    ).toBe('b');
  });

  it('should return original if delimiter not found', () => {
    expect(extract('no delimiter', { type: 'delimiter', delimiter: '####' })).toBe('no delimiter');
  });
});

describe('extract - last-line', () => {
  it('should extract last non-empty line', () => {
    expect(extract('line 1\nline 2\nthe answer\n', { type: 'last-line' })).toBe('the answer');
  });

  it('should trim by default', () => {
    expect(extract('first\n  second  ', { type: 'last-line' })).toBe('second');
  });
});

describe('extract - choice-index', () => {
  it('should map letter to index with default labels', () => {
    expect(extract('The answer is C', { type: 'choice-index' })).toBe('2');
  });

  it('should map B to 1', () => {
    expect(extract('B', { type: 'choice-index' })).toBe('1');
  });

  it('should use custom labels', () => {
    expect(
      extract('Answer: 2', { type: 'choice-index', labels: ['1', '2', '3', '4'], pattern: '[1-4]' }),
    ).toBe('1');
  });

  it('should return original if no letter found', () => {
    expect(extract('I think so', { type: 'choice-index' })).toBe('I think so');
  });
});
