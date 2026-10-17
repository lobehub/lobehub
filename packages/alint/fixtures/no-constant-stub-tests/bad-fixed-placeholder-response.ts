import { expect, it } from 'vitest';

// Disabled legacy endpoint: returns a literal placeholder without any computation.
const legacyStatus = () => ({ enabled: false, reason: 'Legacy workflow retired' });

// alint-expect
it('returns the legacy status placeholder', () => {
  expect(legacyStatus()).toEqual({ enabled: false, reason: 'Legacy workflow retired' });
});
