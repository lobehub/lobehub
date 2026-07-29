import { describe, expect, it } from 'vitest';

import {
  type AcceptanceCheck,
  checkFilterState,
  focusedCheckStates,
  groupChecks,
  isCheckWorkActionable,
  shouldGroupChecks,
  userReviewState,
} from './CheckList';

const check = (id: string, category: string | null, surface: AcceptanceCheck['surface']) =>
  ({ category, id, surface }) as AcceptanceCheck;

describe('groupChecks', () => {
  it('groups checks by business category', () => {
    const groups = groupChecks(
      [
        check('duration', 'Rate-limit recovery', 'desktop'),
        check('reset', 'Rate-limit recovery', 'cli'),
        check('browser', 'Browser actions', 'desktop'),
      ],
      'Other requirements',
    );

    expect(
      groups.map(({ key, label, checks }) => ({ ids: checks.map((item) => item.id), key, label })),
    ).toEqual([
      {
        ids: ['duration', 'reset'],
        key: 'category:Rate-limit recovery',
        label: 'Rate-limit recovery',
      },
      { ids: ['browser'], key: 'category:Browser actions', label: 'Browser actions' },
    ]);
  });

  it('never falls back to technical surfaces', () => {
    const groups = groupChecks(
      [check('desktop', null, 'desktop'), check('cli', null, 'cli')],
      'Other requirements',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('uncategorized');
    expect(groups[0]?.label).toBe('Other requirements');
    expect(groups[0]?.checks.map((item) => item.id)).toEqual(['desktop', 'cli']);
  });
});

describe('shouldGroupChecks', () => {
  it('keeps checklists with 10 or fewer items flat', () => {
    expect(shouldGroupChecks(9)).toBe(false);
    expect(shouldGroupChecks(10)).toBe(false);
  });

  it('groups checklists only after they exceed 10 items', () => {
    expect(shouldGroupChecks(11)).toBe(true);
  });
});

describe('userReviewState', () => {
  const withReview = (userReview: AcceptanceCheck['userReview']) =>
    ({ userReview }) as AcceptanceCheck;

  it('is pending when the user never reviewed the check', () => {
    expect(userReviewState(withReview(undefined))).toBe('pending');
  });

  it('an accept stays settled across rounds', () => {
    expect(
      userReviewState(
        withReview({
          action: 'accept',
          createdAt: '2026-07-16T00:00:00.000Z',
          roundIndex: 1,
          stale: false,
        }),
      ),
    ).toBe('accepted');
  });

  it('an ignore stays out of the review queue across rounds', () => {
    expect(
      userReviewState(
        withReview({
          action: 'ignore',
          createdAt: '2026-07-16T00:00:00.000Z',
          roundIndex: 1,
          stale: false,
        }),
      ),
    ).toBe('ignored');
  });

  it('a reject stands until a newer round consumes it, then reverts to pending', () => {
    const reject = {
      action: 'reject' as const,
      comment: 'misaligned',
      createdAt: '2026-07-16T00:00:00.000Z',
      roundIndex: 2,
    };
    expect(userReviewState(withReview({ ...reject, stale: false }))).toBe('rejected');
    expect(userReviewState(withReview({ ...reject, stale: true }))).toBe('pending');
  });
});

describe('isCheckWorkActionable', () => {
  const withReview = (action?: 'accept' | 'ignore' | 'reject') =>
    ({
      userReview: action
        ? {
            action,
            createdAt: '2026-07-16T00:00:00.000Z',
            roundIndex: 1,
            stale: false,
          }
        : undefined,
    }) as AcceptanceCheck;

  it('keeps work available for pending and rejected checks', () => {
    expect(isCheckWorkActionable(withReview())).toBe(true);
    expect(isCheckWorkActionable(withReview('reject'))).toBe(true);
  });

  it('hides work for accepted and ignored checks', () => {
    expect(isCheckWorkActionable(withReview('accept'))).toBe(false);
    expect(isCheckWorkActionable(withReview('ignore'))).toBe(false);
  });
});

describe('checkFilterState', () => {
  const reject = (stale: boolean): AcceptanceCheck['userReview'] => ({
    action: 'reject',
    comment: 'x',
    createdAt: '2026-07-16T00:00:00.000Z',
    roundIndex: 2,
    stale,
  });
  const make = (state: AcceptanceCheck['state'], userReview?: AcceptanceCheck['userReview']) =>
    ({ state, userReview }) as AcceptanceCheck;

  // The bucket tracks the USER's decision, never the verifier's verdict alone.
  it('a verifier-uncertain check you have not reviewed is pending, not needsFix', () => {
    expect(checkFilterState(make('uncertain'))).toBe('pending');
  });

  it('a verifier-failed check you have not reviewed is pending (awaiting your review)', () => {
    expect(checkFilterState(make('failed'))).toBe('pending');
  });

  it('a never-executed check you have not reviewed is pending', () => {
    expect(checkFilterState(make('not_executed'))).toBe('pending');
  });

  it('a passed-but-unconfirmed check is pending', () => {
    expect(checkFilterState(make('passed'))).toBe('pending');
  });

  it('needsFix only when you rejected it — even if the verifier passed it', () => {
    expect(checkFilterState(make('passed', reject(false)))).toBe('needsFix');
    expect(checkFilterState(make('uncertain', reject(false)))).toBe('needsFix');
  });

  it('a stale reject reverts to pending, not needsFix (its feedback was consumed)', () => {
    expect(checkFilterState(make('uncertain', reject(true)))).toBe('pending');
  });

  it('accepted when you signed it off', () => {
    expect(
      checkFilterState(
        make('passed', {
          action: 'accept',
          createdAt: '2026-07-16T00:00:00.000Z',
          roundIndex: 1,
          stale: false,
        }),
      ),
    ).toBe('accepted');
  });

  it('ignored when you removed the check from the acceptance scope', () => {
    expect(
      checkFilterState(
        make('failed', {
          action: 'ignore',
          createdAt: '2026-07-16T00:00:00.000Z',
          roundIndex: 1,
          stale: false,
        }),
      ),
    ).toBe('ignored');
  });
});

describe('focusedCheckStates', () => {
  it.each([
    ['failed', 'failed'],
    ['uncertain', 'uncertain'],
    ['not_executed', 'notExecuted'],
    ['passed', 'passed'],
  ] as const)(
    'preserves the %s verifier result while the user review remains pending',
    (verifier, verifierLabel) => {
      expect(focusedCheckStates({ state: verifier } as AcceptanceCheck)).toEqual({
        review: 'pending',
        verifier,
        verifierLabel,
      });
    },
  );
});
