import { expect, it } from 'vitest';

const accepts = (size: number) => size > 0 && size <= 100;

it.each([
  [0, false],
  [1, true],
  [100, true],
  [101, false],
])('accepts size %i: %s', (size, expected) => {
  expect(accepts(size)).toBe(expected);
});
