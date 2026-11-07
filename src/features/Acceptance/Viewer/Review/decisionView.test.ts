import { describe, expect, it } from 'vitest';

import { resolveDecisionView } from './decisionView';

// Keys are enough to read the state line: the copy itself lives in locales.
const t = ((key: string, params?: { count?: number }) =>
  params?.count === undefined ? key : `${key}=${params.count}`) as never;

const check = (overrides: Record<string, unknown>) =>
  ({
    id: 'c',
    reviews: [],
    seq: 1,
    state: 'passed',
    title: 'c',
    userReview: null,
    ...overrides,
  }) as never;

const bundle = (checks: unknown[]) =>
  ({ acceptance: { completedAt: null, status: 'accepted' }, checks, rounds: [] }) as never;

const stateLine = (checks: unknown[]) =>
  resolveDecisionView(bundle(checks), t, { hydrated: false }).subText ?? '';

describe('resolveDecisionView state line', () => {
  it('reports a failed check while the verdict still gates the delivery', () => {
    expect(stateLine([check({ id: 'a' }), check({ id: 'b', state: 'failed' })])).toContain(
      'acceptance.stats.failed=1',
    );
  });

  it('drops a dispute-waived failure from the counts', () => {
    // The row keeps `state: failed` for its timeline, but an upheld
    // invalid_criterion dispute means it no longer gates acceptance — the run
    // counters and the canonical tally already skip it, so the banner must too.
    const line = stateLine([check({ id: 'a' }), check({ id: 'b', state: 'failed', waived: true })]);

    expect(line).not.toContain('acceptance.stats.failed');
    expect(line).toContain('acceptance.stats.passed=1');
  });
});
