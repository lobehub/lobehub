import { expect, it } from 'vitest';

let enabled = false;
const read = () => ({ enabled });

it('starts disabled', () => {
  expect(read().enabled).toBe(false);
});

it('returns the updated value after enabling', () => {
  enabled = true;
  expect(read()).toEqual({ enabled: true });
});
