import { describe, expect, it } from 'vitest';

import { canViewAcceptanceHistory, resolveAcceptanceHistoryNavigation } from './visibility';

describe('canViewAcceptanceHistory', () => {
  it('keeps run history available to the acceptance owner', () => {
    expect(canViewAcceptanceHistory(true)).toBe(true);
  });

  it('hides run history from shared viewers', () => {
    expect(canViewAcceptanceHistory(false)).toBe(false);
  });

  it('removes round navigation from shared viewers instead of leaving dead controls', () => {
    const onRound = () => {};

    expect(resolveAcceptanceHistoryNavigation(false, onRound)).toBeUndefined();
    expect(resolveAcceptanceHistoryNavigation(true, onRound)).toBe(onRound);
  });
});
