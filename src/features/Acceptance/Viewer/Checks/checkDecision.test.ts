import { describe, expect, it } from 'vitest';

import { checkDecision, decisionSections, decisionSegments } from './checkDecision';
import type { AcceptanceCheck } from './types';

const check = (partial: Partial<AcceptanceCheck>) =>
  ({
    result: { id: 'r' },
    reviews: [],
    state: 'passed',
    userReview: null,
    ...partial,
  }) as AcceptanceCheck;

const review = (action: string, stale = false) =>
  ({ action, stale }) as unknown as AcceptanceCheck['userReview'];

describe('checkDecision', () => {
  it('reads an unreviewed executed check as pending whatever the verifier said', () => {
    expect(checkDecision(check({ state: 'failed' }))).toBe('pending');
    expect(checkDecision(check({ state: 'passed' }))).toBe('pending');
  });

  it('reads a check with no result as not run instead of awaiting review', () => {
    expect(checkDecision(check({ result: null, state: 'not_executed' }))).toBe('notRun');
  });

  it('keeps the reviewer decision apart from the verifier verdict', () => {
    expect(checkDecision(check({ state: 'failed', userReview: review('accept') }))).toBe(
      'accepted',
    );
    expect(checkDecision(check({ state: 'passed', userReview: review('reject') }))).toBe(
      'needsFix',
    );
    expect(checkDecision(check({ userReview: review('ignore') }))).toBe('ignored');
  });

  it('treats a stale review as pending again', () => {
    expect(checkDecision(check({ userReview: review('accept', true) }))).toBe('pending');
  });
});

describe('decisionSegments', () => {
  it('orders settled checks first so the strip fills from the start', () => {
    expect(
      decisionSegments([
        check({}),
        check({ userReview: review('reject') }),
        check({ userReview: review('accept') }),
        check({ userReview: review('ignore') }),
        check({ result: null, state: 'not_executed' }),
      ]),
    ).toEqual(['accepted', 'needsFix', 'ignored', 'pending', 'pending']);
  });
});

describe('decisionSections', () => {
  it('puts what still needs a decision first and keeps each section in list order', () => {
    const a = check({ id: 'a', userReview: review('accept') });
    const b = check({ id: 'b' });
    const c = check({ id: 'c', result: null, state: 'not_executed' });
    const d = check({ id: 'd', userReview: review('reject') });

    expect(
      decisionSections([a, b, c, d]).map((section) => [
        section.key,
        section.checks.map((item) => item.id),
      ]),
    ).toEqual([
      ['pending', ['b', 'c']],
      ['needsFix', ['d']],
      ['accepted', ['a']],
    ]);
  });
});
