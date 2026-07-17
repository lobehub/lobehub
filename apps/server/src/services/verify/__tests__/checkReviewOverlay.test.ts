// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { VerifyCheckResultItem } from '@/database/schemas/verify';

import { buildCheckReviewOverlay } from '../acceptanceService';

/** A result row carrying (or not) a user decision + its detail bag. */
const result = (
  id: string,
  overrides: Partial<VerifyCheckResultItem> = {},
): VerifyCheckResultItem =>
  ({
    createdAt: new Date('2026-07-16T00:00:00.000Z'),
    id,
    userDecision: null,
    userDecisionDetail: null,
    ...overrides,
  }) as VerifyCheckResultItem;

const timelineEntry = (resultId: string, roundIndex: number) => ({
  resultId,
  roundIndex,
  state: 'passed' as const,
  title: `round ${roundIndex}`,
  verifyRunId: `run-${roundIndex}`,
});

const byId = (...rows: VerifyCheckResultItem[]) => new Map(rows.map((row) => [row.id, row]));

describe('buildCheckReviewOverlay', () => {
  it('returns no standing verdict when no result row carries a decision', () => {
    const overlay = buildCheckReviewOverlay(
      { timeline: [timelineEntry('r1', 1)] },
      byId(result('r1')),
      2,
    );
    expect(overlay.userReview).toBeUndefined();
    expect(overlay.reviews).toHaveLength(0);
  });

  it('an accept on an earlier round stands across later rounds (sticky)', () => {
    const accepted = result('r1', {
      userDecision: 'accepted',
      userDecisionDetail: { decidedAt: '2026-07-16T01:00:00.000Z' },
    });
    const overlay = buildCheckReviewOverlay(
      // Round 3 re-ran the check but the user never re-reviewed it.
      { timeline: [timelineEntry('r1', 1), timelineEntry('r3', 3)] },
      byId(accepted, result('r3')),
      3,
    );
    expect(overlay.userReview).toMatchObject({ action: 'accept', roundIndex: 1, stale: false });
  });

  it('a reject at the current round stands; a newer round demotes it to history', () => {
    const rejected = result('r2', {
      userDecision: 'rejected',
      userDecisionDetail: { comment: 'misaligned', decidedAt: '2026-07-16T01:00:00.000Z' },
    });

    const current = buildCheckReviewOverlay(
      { timeline: [timelineEntry('r2', 2)] },
      byId(rejected),
      2,
    );
    expect(current.userReview).toMatchObject({
      action: 'reject',
      comment: 'misaligned',
      stale: false,
    });

    const afterNewRound = buildCheckReviewOverlay(
      { timeline: [timelineEntry('r2', 2), timelineEntry('r3', 3)] },
      byId(rejected, result('r3')),
      3,
    );
    expect(afterNewRound.userReview).toMatchObject({ action: 'reject', stale: true });
    // The trail keeps the consumed feedback for the iteration history.
    expect(afterNewRound.reviews).toHaveLength(1);
  });

  it('the newest decision wins: a re-accept on a later round settles the check', () => {
    const rejected = result('r1', {
      userDecision: 'rejected',
      userDecisionDetail: { comment: 'nope', decidedAt: '2026-07-16T01:00:00.000Z' },
    });
    const accepted = result('r2', {
      userDecision: 'accepted',
      userDecisionDetail: { decidedAt: '2026-07-16T02:00:00.000Z' },
    });
    const overlay = buildCheckReviewOverlay(
      { timeline: [timelineEntry('r1', 1), timelineEntry('r2', 2)] },
      byId(rejected, accepted),
      3,
    );
    expect(overlay.userReview).toMatchObject({ action: 'accept', roundIndex: 2, stale: false });
    expect(overlay.reviews.map((entry) => entry.action)).toEqual(['reject', 'accept']);
  });

  it('a reject on a carried-forward check stands — the decision round, not the evidence round, arbitrates staleness', () => {
    // The check's only result row is from round 1 (carried forward into round
    // 2), and the user rejects it WHILE round 2 is current. That reject must
    // stand — it is brand-new feedback, not something round 2 already consumed.
    const carried = result('r1', {
      userDecision: 'rejected',
      userDecisionDetail: {
        comment: 'contrast still off',
        decidedAt: '2026-07-16T01:00:00.000Z',
        roundIndex: 2,
      },
    });
    const overlay = buildCheckReviewOverlay(
      { timeline: [timelineEntry('r1', 1)] },
      byId(carried),
      2,
    );
    expect(overlay.userReview).toMatchObject({ action: 'reject', roundIndex: 2, stale: false });
  });

  it('surfaces the reject attachment fileIds so the bundle can resolve them to URLs', () => {
    const withShots = result('r1', {
      userDecision: 'rejected',
      userDecisionDetail: {
        comment: 'see the screenshots',
        decidedAt: '2026-07-16T01:00:00.000Z',
        fileIds: ['file-a', 'file-b'],
      },
    });
    const overlay = buildCheckReviewOverlay(
      { timeline: [timelineEntry('r1', 1)] },
      byId(withShots),
      1,
    );
    // The overlay carries the raw ids on the trail; the bundle read resolves
    // them to URLs (userReview.attachments) off this latest review.
    expect(overlay.reviews[0].fileIds).toEqual(['file-a', 'file-b']);
    expect(overlay.userReview).toMatchObject({ action: 'reject', roundIndex: 1 });
  });

  it('carries annotations and falls back to row timestamps for legacy decisions', () => {
    const annotated = result('r1', {
      userDecision: 'rejected',
      userDecisionDetail: {
        annotations: [
          {
            comment: 'this area',
            evidenceId: 'ev-1',
            rect: { height: 0.2, width: 0.2, x: 0, y: 0 },
          },
        ],
        comment: 'see region',
        decidedAt: '2026-07-16T01:00:00.000Z',
      },
    });
    // A legacy decision written before the detail column existed.
    const legacy = result('r2', { userDecision: 'accepted' });

    const overlay = buildCheckReviewOverlay(
      { timeline: [timelineEntry('r1', 1), timelineEntry('r2', 2)] },
      byId(annotated, legacy),
      2,
    );
    expect(overlay.reviews).toHaveLength(2);
    expect(overlay.reviews[1].annotations?.[0]?.comment).toBe('this area');
    expect(overlay.reviews[0].createdAt).toBe('2026-07-16T00:00:00.000Z');
  });
});
