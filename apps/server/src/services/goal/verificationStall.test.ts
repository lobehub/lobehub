import { describe, expect, it } from 'vitest';

import { failureSignature, isVerificationStalled } from './verificationStall';

const plan = [
  { id: 'c1', required: true, title: 'Input reaches the game' },
  { id: 'c2', required: true, title: 'Latency is measured' },
  { id: 'c3', required: false, title: 'Optional screenshot' },
];

let createdAt = Date.parse('2026-10-11T15:00:00Z');
const round = (
  status: string,
  metadata: Record<string, unknown> = { taskDrivenAt: 'settled' },
  id = `r${createdAt}`,
) => ({
  createdAt: new Date((createdAt += 60_000)),
  id,
  metadata,
  plan,
  status,
});
const passed = (checkItemId: string) => ({ checkItemId, status: 'passed', verdict: 'passed' });
const failed = (checkItemId: string) => ({ checkItemId, status: 'failed', verdict: 'failed' });

const rejectedByReview = (feedback: string) =>
  round('passed', {
    goalReview: { feedback, predictionIds: [], status: 'rejected' },
    taskDrivenAt: 'x',
  });

describe('failureSignature', () => {
  it('names the required checks a failed round left open', () => {
    expect(failureSignature(round('failed'), [passed('c1'), failed('c3')])).toBe('checks:c2');
  });

  it('reads a review rejection by its feedback', () => {
    expect(failureSignature(rejectedByReview(' C1: Submit current evidence. '), [])).toBe(
      'review:C1: Submit current evidence.',
    );
  });

  it('has none for a delivery that passed or a verifier that could not run', () => {
    expect(failureSignature(round('passed'), [passed('c1'), passed('c2')])).toBeUndefined();
    expect(failureSignature(round('errored'), [])).toBeUndefined();
  });
});

describe('isVerificationStalled', () => {
  it('stops after two attempts fail on the same checks', () => {
    expect(
      isVerificationStalled([
        { results: [passed('c1'), failed('c2')], round: round('failed') },
        { results: [passed('c1'), failed('c2')], round: round('failed') },
      ]),
    ).toBe(true);
  });

  /** A Task loop seen in production: every attempt was sent back with the same canned feedback. */
  it('stops after two attempts the review sends back with the same feedback', () => {
    const feedback = 'Input reaches the game: Submit current evidence for this required check.';
    expect(
      isVerificationStalled([
        { results: [], round: rejectedByReview(feedback) },
        { results: [], round: rejectedByReview(feedback) },
      ]),
    ).toBe(true);
  });

  /**
   * A generated first plan keeps its own item ids next to `sourceCriterionId`;
   * the retry is re-planned from the acceptance union under the criterion id.
   * Comparing local ids let identical failures look different.
   */
  it('matches the first attempt to a retry re-planned under criterion ids', () => {
    const generated = {
      ...round('failed'),
      plan: plan.map((item) => ({ ...item, id: `gen-${item.id}`, sourceCriterionId: item.id })),
    };
    const retry = {
      ...round('failed'),
      plan: plan.map((item) => ({ ...item, sourceCriterionId: item.id })),
    };
    expect(
      isVerificationStalled([
        { results: [passed('gen-c1'), failed('gen-c2')], round: generated },
        { results: [passed('c1'), failed('c2')], round: retry },
      ]),
    ).toBe(true);
  });

  it('keeps retrying while each attempt fails on something else', () => {
    expect(
      isVerificationStalled([
        { results: [failed('c1'), passed('c2')], round: round('failed') },
        { results: [passed('c1'), failed('c2')], round: round('failed') },
      ]),
    ).toBe(false);
  });

  it('counts one round per attempt, not the repair rounds inside it', () => {
    expect(
      isVerificationStalled([
        { results: [failed('c2')], round: round('failed', {}) },
        { results: [failed('c2')], round: round('failed') },
      ]),
    ).toBe(false);
  });

  it('gives a Retry the person chose its own attempts', () => {
    const first = round('failed');
    const answeredAt = new Date((createdAt += 1000));
    const second = round('failed');
    expect(
      isVerificationStalled(
        [
          { results: [failed('c2')], round: first },
          { results: [failed('c2')], round: second },
        ],
        answeredAt,
      ),
    ).toBe(false);
  });

  it('does not read a verifier outage as a repeated failure', () => {
    expect(
      isVerificationStalled([
        { results: [], round: round('errored') },
        { results: [], round: round('errored') },
      ]),
    ).toBe(false);
  });
});
