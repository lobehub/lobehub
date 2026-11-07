import { expect, it } from 'vitest';

const parse = (input: string) => {
  if (!input) throw new Error('missing');
  if (input.includes('/')) throw new Error('invalid path');
  return input;
};

it('rejects a missing value', () => {
  expect(() => parse('')).toThrow('missing');
});

it('rejects a path', () => {
  expect(() => parse('a/b')).toThrow('invalid path');
});
