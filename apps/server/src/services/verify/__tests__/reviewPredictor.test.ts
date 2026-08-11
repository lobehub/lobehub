import { describe, expect, it } from 'vitest';

import { shouldSurfaceProposal } from '../reviewPredictor';

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
    expect(shouldSurfaceProposal({}, false)).toBe(true);
  });

  it('withholds a proposal the reviewer already dismissed', () => {
    expect(shouldSurfaceProposal({ adjudication: 'not-an-issue' }, false)).toBe(false);
  });

  it('withholds a proposal marked as misidentified', () => {
    expect(shouldSurfaceProposal({ adjudication: 'misidentified' }, false)).toBe(false);
  });

  it('withholds once the check itself has a verdict', () => {
    expect(shouldSurfaceProposal({}, true)).toBe(false);
  });
});
