import { REVIEW_PREDICT_PROMPT_VERSION } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { isCurrentReviewPrediction, shouldSurfaceProposal } from '../reviewPredictor';

/**
 * Regression: a dismissed proposal came back on every reload.
 *
 * The first implementation surfaced a proposal whenever the CHECK had no
 * verdict — but `not-an-issue` and `misidentified` deliberately leave the check
 * unjudged, so answering the model changed nothing the read path looked at. The
 * reviewer dismissed the card and it reappeared, forever.
 */
describe('shouldSurfaceProposal', () => {
  it('surfaces an unanswered proposal on an unjudged check', () => {
    expect(shouldSurfaceProposal({ action: 'reject' }, false)).toBe(true);
  });

  it('withholds a proposal the reviewer already dismissed', () => {
    expect(shouldSurfaceProposal({ action: 'reject', adjudication: 'not-an-issue' }, false)).toBe(
      false,
    );
  });

  it('withholds a proposal marked as misidentified', () => {
    expect(shouldSurfaceProposal({ action: 'reject', adjudication: 'misidentified' }, false)).toBe(
      false,
    );
  });

  /**
   * Regression: every attempt is now persisted, including the ones with nothing
   * to show. Before this gate, an `accept` row — or a `skipped` one written
   * because the check had no screenshot — rendered an empty proposal card
   * asking the reviewer to adjudicate an opinion that was never formed.
   */
  it('withholds a prediction that judged the check as passing', () => {
    expect(shouldSurfaceProposal({ action: 'accept' }, false)).toBe(false);
  });

  it('withholds an attempt that produced no verdict at all', () => {
    expect(shouldSurfaceProposal({ action: null }, false)).toBe(false);
    expect(shouldSurfaceProposal({}, false)).toBe(false);
  });

  it('withholds once the check itself has a verdict', () => {
    expect(shouldSurfaceProposal({ action: 'reject' }, true)).toBe(false);
  });

  /**
   * Regression: a STALE review is last round's rejection kept as history, while
   * this round's result is undecided. Passing it as "settled" hid the proposal
   * on exactly the repair round where the reviewer has to judge again — the
   * caller must therefore pass `userReview && !userReview.stale`, not
   * `Boolean(userReview)`.
   */
  it('treats a check as unsettled when its only review is stale', () => {
    const staleReject = { action: 'reject', stale: true };
    const settled = Boolean(staleReject && !staleReject.stale);
    expect(settled).toBe(false);
    expect(shouldSurfaceProposal({ action: 'reject' }, settled)).toBe(true);
  });

  it('treats a check as settled when its review is current', () => {
    const currentReject = { action: 'reject', stale: false };
    const settled = Boolean(currentReject && !currentReject.stale);
    expect(shouldSurfaceProposal({ action: 'reject' }, settled)).toBe(false);
  });
});

/**
 * Regression: the bundle took the newest row across ALL models. After the
 * pinned model changed, a stale row from the old one satisfied "the batch
 * finished" the instant the current model's row was cleared for re-judging.
 */
describe('isCurrentReviewPrediction', () => {
  const current = { model: 'gemini-3.6-flash', provider: 'google' };

  it('accepts a row from the pinned model on the current prompt version', () => {
    expect(
      isCurrentReviewPrediction(
        { ...current, promptVersion: REVIEW_PREDICT_PROMPT_VERSION },
        current,
      ),
    ).toBe(true);
  });

  it('rejects rows from another model, provider, or prompt version', () => {
    expect(
      isCurrentReviewPrediction(
        {
          model: 'deepseek-v4-pro',
          promptVersion: REVIEW_PREDICT_PROMPT_VERSION,
          provider: 'lobehub',
        },
        current,
      ),
    ).toBe(false);
    expect(isCurrentReviewPrediction({ ...current, promptVersion: 'v0' }, current)).toBe(false);
  });
});
