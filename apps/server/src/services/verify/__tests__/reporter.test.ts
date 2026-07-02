import { describe, expect, it } from 'vitest';

import type { VerifyCheckResultItem } from '@/database/schemas/verify';

import { countStats, rollupVerdict } from '../reportRollup';

/** Minimal result-row factory — only the fields the rollup reads. */
const r = (over: Partial<VerifyCheckResultItem>): VerifyCheckResultItem =>
  ({ required: true, status: 'passed', verdict: 'passed', ...over }) as VerifyCheckResultItem;

describe('rollupVerdict', () => {
  it('fails when any required item failed (by verdict or status)', () => {
    expect(rollupVerdict([r({}), r({ status: 'failed', verdict: 'failed' })])).toBe('failed');
    // structural-gate row: status failed + verdict uncertain still gates as failed
    expect(rollupVerdict([r({ status: 'failed', verdict: 'uncertain' })])).toBe('failed');
  });

  it('is uncertain when a required item is unresolved but none failed', () => {
    expect(rollupVerdict([r({}), r({ status: 'pending', verdict: null })])).toBe('uncertain');
    expect(rollupVerdict([r({ status: 'running', verdict: 'uncertain' })])).toBe('uncertain');
  });

  it('passes when every required item passed', () => {
    expect(rollupVerdict([r({}), r({})])).toBe('passed');
  });

  it('ignores non-required items in the gate', () => {
    expect(
      rollupVerdict([r({}), r({ required: false, status: 'failed', verdict: 'failed' })]),
    ).toBe('passed');
    // skipped required items are not "unresolved"
    expect(rollupVerdict([r({ status: 'skipped', verdict: null })])).toBe('passed');
  });
});

describe('countStats', () => {
  it('counts verdicts and totals (pending/skipped only in total)', () => {
    expect(
      countStats([
        r({ verdict: 'passed' }),
        r({ verdict: 'failed' }),
        r({ verdict: 'uncertain' }),
        r({ verdict: null, status: 'pending' }),
      ]),
    ).toEqual({ failed: 1, passed: 1, total: 4, uncertain: 1 });
  });
});
