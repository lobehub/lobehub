import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { blindSlicePosition, isBlindControlCheck, shouldSurfaceProposal } from '../reviewPredictor';

/**
 * The blind control slice ships DISABLED (rate 0) — it exists to measure how far
 * a shown proposal moves the reviewer's own judgement, which only matters once
 * labels are being collected for training. These tests therefore pass an
 * explicit rate: they guard the mechanism, not the shipped default.
 */
const RATE = 0.2;
describe('blind control slice', () => {
  it('is stable for the same check id', () => {
    // A check that flips in or out between page loads would show a proposal on
    // something the reviewer had already started judging cold, contaminating
    // the one unbiased population.
    const id = randomUUID();
    const first = isBlindControlCheck(id, RATE);
    for (let index = 0; index < 50; index += 1) {
      expect(isBlindControlCheck(id, RATE)).toBe(first);
    }
  });

  it('always lands inside the unit interval', () => {
    for (let index = 0; index < 500; index += 1) {
      const position = blindSlicePosition(randomUUID());
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(1);
    }
  });

  it('carves out roughly the configured share', () => {
    const sample = 4000;
    let blind = 0;
    for (let index = 0; index < sample; index += 1) {
      if (isBlindControlCheck(randomUUID(), RATE)) blind += 1;
    }
    const rate = blind / sample;
    // Generous band: this asserts the hash spreads, not that it is a perfect
    // uniform source. A broken hash (all-or-nothing, or clustered) fails wide.
    expect(rate).toBeGreaterThan(RATE - 0.05);
    expect(rate).toBeLessThan(RATE + 0.05);
  });

  it('spreads ids that share a long prefix', () => {
    // Real check-result ids are uuids that can share a leading run of
    // characters; a weak hash would bucket those together and make the control
    // slice correlate with whole acceptances rather than individual checks.
    const positions = Array.from({ length: 200 }, (_, index) =>
      blindSlicePosition(`0193c5f0-1a2b-7c3d-8e4f-${String(index).padStart(12, '0')}`),
    );
    const buckets = new Set(positions.map((position) => Math.floor(position * 10)));
    expect(buckets.size).toBeGreaterThan(7);
  });
});

/**
 * Regression: a dismissed proposal came back on every reload.
 *
 * The first implementation surfaced a proposal whenever the CHECK had no
 * verdict — but `not-an-issue` and `misidentified` deliberately leave the check
 * unjudged, so answering the model changed nothing the read path looked at. The
 * reviewer dismissed the card and it reappeared, forever.
 */
describe('shouldSurfaceProposal', () => {
  // Chosen from the measured distribution so these ids are stable inputs.
  const visible = '501b264c-588d-480a-998a-4d6e61331a0b'; // position 0.313 — outside the slice
  const blind = (() => {
    for (let index = 0; index < 10_000; index += 1) {
      const id = `blind-candidate-${index}`;
      if (isBlindControlCheck(id, RATE)) return id;
    }
    throw new Error('no blind id found');
  })();

  it('surfaces an unanswered proposal on an unjudged check', () => {
    expect(shouldSurfaceProposal({ checkResultId: visible }, false)).toBe(true);
  });

  it('withholds a proposal the reviewer already dismissed', () => {
    expect(
      shouldSurfaceProposal({ adjudication: 'not-an-issue', checkResultId: visible }, false),
    ).toBe(false);
  });

  it('withholds a proposal marked as misidentified', () => {
    expect(
      shouldSurfaceProposal({ adjudication: 'misidentified', checkResultId: visible }, false),
    ).toBe(false);
  });

  it('withholds once the check itself has a verdict', () => {
    expect(shouldSurfaceProposal({ checkResultId: visible }, true)).toBe(false);
  });

  it('withholds for a blind-control check even when a proposal exists', () => {
    expect(shouldSurfaceProposal({ checkResultId: blind }, false, RATE)).toBe(false);
  });

  it('surfaces that same check once the blind slice is disabled (the shipped default)', () => {
    expect(shouldSurfaceProposal({ checkResultId: blind }, false)).toBe(true);
  });
});
