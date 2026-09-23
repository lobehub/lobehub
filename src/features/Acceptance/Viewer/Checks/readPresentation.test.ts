import { describe, expect, it } from 'vitest';

import {
  collectGroupFeedback,
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
