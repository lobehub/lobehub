import { describe, expect, it } from 'vitest';

import {
  canReviewAcceptance,
  canViewAcceptanceHistory,
  resolveAcceptanceHistoryNavigation,
} from './visibility';

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

describe('canReviewAcceptance', () => {
  it('follows the server flag, not ownership', () => {
    // A workspace owner opening a teammate's delivery is not the creator, but
    // the write path lets them review — the UI must say the same thing.
    expect(canReviewAcceptance({ canReview: true, isOwner: false })).toBe(true);
    expect(canReviewAcceptance({ canReview: false, isOwner: true })).toBe(false);
  });

  it('withholds the actions from a shared viewer, whose writes cannot land', () => {
    expect(canReviewAcceptance({ canReview: false })).toBe(false);
  });

  it('treats a not-yet-loaded bundle as read-only', () => {
    expect(canReviewAcceptance(undefined)).toBe(false);
    expect(canReviewAcceptance(null)).toBe(false);
  });
});
