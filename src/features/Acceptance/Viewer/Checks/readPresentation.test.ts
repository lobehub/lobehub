import { describe, expect, it } from 'vitest';

import {
  collectGroupFeedback,
  hasCheckHistory,
  historicalEvidenceContext,
  splitCheckReviews,
} from './readPresentation';
import type { AcceptanceCheck } from './types';

describe('read-only check presentation', () => {
  it('retains group feedback attachments and stamps each entry with its source round', () => {
    const attachment = { id: 'file', url: 'https://example.com/file.png' };
    const rounds = [
      {
        run: {
          decisionDetail: {
            groupFeedback: [
              {
                attachments: [attachment],
                category: 'UX',
                comment: 'Keep this concern visible',
                createdAt: '2026-09-01T00:00:00.000Z',
              },
            ],
          },
          roundIndex: 4,
        },
      },
    ];

    expect(collectGroupFeedback(rounds as never)).toEqual([
      expect.objectContaining({ attachments: [attachment], category: 'UX', roundIndex: 4 }),
    ]);
  });

  it('separates the standing verdict from stale review history', () => {
    const oldReview = { id: 'old', roundIndex: 1 };
    const standingReview = { id: 'standing', roundIndex: 2 };
    const check = {
      reviews: [oldReview, standingReview],
      userReview: { action: 'reject', stale: false },
    } as AcceptanceCheck;

    expect(splitCheckReviews(check)).toEqual({
      activeReview: standingReview,
      historyReviews: [oldReview],
    });
  });

  it('keeps all reviews in history when the verdict was consumed by a newer round', () => {
    const reviews = [{ id: 'old', roundIndex: 1 }];
    const check = { reviews, userReview: { action: 'reject', stale: true } } as AcceptanceCheck;

    expect(splitCheckReviews(check)).toEqual({ historyReviews: reviews });
  });

  it.each([
    { expected: false, label: 'not executed', rounds: [] },
    { expected: false, label: 'first execution', rounds: [1] },
    { expected: false, label: 'first execution in a later round', rounds: [3] },
    { expected: true, label: 'two executions with a skipped round', rounds: [1, 3] },
  ])('shows history only for prior results: $label', ({ expected, rounds }) => {
    const check = {
      revisions: rounds.length,
      // The backend includes the current result, not just previous results.
      timeline: rounds.map((roundIndex) => ({ roundIndex })),
    } as AcceptanceCheck;

    expect(hasCheckHistory(check, [])).toBe(expected);
  });

  it.each([
    { expected: false, label: 'only the standing verdict', stale: false },
    { expected: true, label: 'feedback consumed without rerunning the check', stale: true },
  ])('preserves review-only history: $label', ({ expected, stale }) => {
    const check = {
      reviews: [{ id: 'review', roundIndex: 1 }],
      revisions: 1,
      timeline: [{ roundIndex: 1 }],
      userReview: { action: 'reject', stale },
    } as AcceptanceCheck;
    const { historyReviews } = splitCheckReviews(check);

    expect(hasCheckHistory(check, historyReviews)).toBe(expected);
  });

  it('resolves a replaced region to its original evidence and round', () => {
    const oldEvidence = { id: 'old-image', type: 'screenshot' };
    const check = {
      evidence: [{ id: 'current-image', type: 'screenshot' }],
      timeline: [{ evidence: [oldEvidence], roundIndex: 3 }],
    } as AcceptanceCheck;

    expect(historicalEvidenceContext(check, 'old-image')).toEqual({
      evidence: oldEvidence,
      roundIndex: 3,
    });
    expect(historicalEvidenceContext(check, 'current-image')).toBeUndefined();
  });
});
