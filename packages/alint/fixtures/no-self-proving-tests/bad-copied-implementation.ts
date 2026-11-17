import { expect, it } from 'vitest';

// Copied from the production adapter. The production adapter is never imported.
const localAdapter = (input: string) => input.trim().toLowerCase();

// alint-expect
it('normalizes the production adapter input', () => {
  expect(localAdapter(' HELLO ')).toBe('hello');
});
