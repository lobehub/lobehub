import { expect, it } from 'vitest';

const normalize = (input: string) => input.trim().toLowerCase();

it('normalizes whitespace and case', () => {
  expect(normalize(' HELLO ')).toBe('hello');
});
