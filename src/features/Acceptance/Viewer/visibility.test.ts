import { describe, expect, it } from 'vitest';

import {
  canCommentOnAcceptanceEvidence,
  canRejectAcceptanceOnly,
  canReviewAcceptance,
  canViewAcceptanceHistory,
  isReadOnlyAcceptanceDecider,
  needsCollaborationRequest,
  resolveAcceptanceHistoryNavigation,
} from './visibility';

describe('canCommentOnAcceptanceEvidence', () => {
  it('allows the acceptance author to comment without rejecting', () => {
    expect(canCommentOnAcceptanceEvidence({ isOwner: true }, true)).toBe(true);
  });

  it('keeps region comments available to another viewer with comment access', () => {
    expect(canCommentOnAcceptanceEvidence({ isOwner: false }, true)).toBe(true);
  });

  it('withholds region comments without comment access or a loaded identity', () => {
    expect(canCommentOnAcceptanceEvidence({ isOwner: false }, false)).toBe(false);
    expect(canCommentOnAcceptanceEvidence(undefined, true)).toBe(false);
  });
});

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

describe('isReadOnlyAcceptanceDecider', () => {
  it('shows a disabled decision bar to a teammate who can approve but not decide', () => {
    expect(isReadOnlyAcceptanceDecider({ canReview: false }, true)).toBe(true);
  });

  it('keeps the live bar for a decider', () => {
    expect(isReadOnlyAcceptanceDecider({ canReview: true }, true)).toBe(false);
  });

  it('shows nothing to a viewer or link visitor who cannot weigh in', () => {
    expect(isReadOnlyAcceptanceDecider({ canReview: false }, false)).toBe(false);
    expect(isReadOnlyAcceptanceDecider(undefined, true)).toBe(false);
  });
});

describe('canRejectAcceptanceOnly', () => {
  it('turns on reject for a reviewer a decider granted reject access to', () => {
    expect(canRejectAcceptanceOnly({ canReject: true, canReview: false })).toBe(true);
  });

  it('leaves a decider on the full bar', () => {
    expect(canRejectAcceptanceOnly({ canReject: true, canReview: true })).toBe(false);
  });

  it('grants nothing without the grant, or before the bundle loads', () => {
    expect(canRejectAcceptanceOnly({ canReject: false, canReview: false })).toBe(false);
    expect(canRejectAcceptanceOnly(undefined)).toBe(false);
  });
});

describe('needsCollaborationRequest', () => {
  it('asks a plain reviewer to request collaboration', () => {
    expect(
      needsCollaborationRequest({ canCollaborate: false, canReview: false, isOwner: false }),
    ).toBe(true);
  });

  it('does not ask a workspace owner/admin who can already decide the delivery', () => {
    expect(
      needsCollaborationRequest({ canCollaborate: false, canReview: true, isOwner: false }),
    ).toBe(false);
  });

  it('does not ask the creator or a viewer who was already granted collaboration', () => {
    expect(
      needsCollaborationRequest({ canCollaborate: false, canReview: true, isOwner: true }),
    ).toBe(false);
    expect(
      needsCollaborationRequest({ canCollaborate: true, canReview: false, isOwner: false }),
    ).toBe(false);
  });

  it('shows nothing before the bundle loads', () => {
    expect(needsCollaborationRequest(undefined)).toBe(false);
  });
});
