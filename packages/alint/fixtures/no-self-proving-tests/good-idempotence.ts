import { expect, it } from 'vitest';

const normalize = (input: string) => input.trim().toLowerCase();

it('is idempotent for already normalized content', () => {
  const normalized = normalize(' HELLO ');
  expect(normalize(normalized)).toBe(normalized);
});
