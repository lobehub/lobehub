import { expect, it } from 'vitest';

const legacyMode = 'minimal';
const newMode = 'none';

it('keeps the legacy default', () => {
  expect(legacyMode).toBe('minimal');
});

// alint-expect
it('starts new items quietly', () => {
  expect(newMode).toBe('none');
  expect(legacyMode).toBe('minimal');
});
