import { describe, expect, it } from 'vitest';

import { canViewAcceptanceHistory } from './visibility';

describe('canViewAcceptanceHistory', () => {
  it('keeps run history available to the acceptance owner', () => {
    expect(canViewAcceptanceHistory(true)).toBe(true);
  });

  it('hides run history from shared viewers', () => {
    expect(canViewAcceptanceHistory(false)).toBe(false);
  });
});
