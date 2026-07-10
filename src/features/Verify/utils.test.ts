import { describe, expect, it } from 'vitest';

import { countResults, isDraftUnconfirmed, itemBehavior, phaseFromStatus } from './utils';

describe('phaseFromStatus', () => {
  it('maps rollup statuses to dock phases', () => {
    expect(phaseFromStatus('planned')).toBe('draft');
    expect(phaseFromStatus('verifying')).toBe('verifying');
    expect(phaseFromStatus('failed')).toBe('failed');
    // `errored` is a terminal, non-pass phase of its own — never `idle` (which
    // would drop the checker body and read as still-pending).
    expect(phaseFromStatus('errored')).toBe('errored');
    expect(phaseFromStatus('repairing')).toBe('repairing');
    expect(phaseFromStatus('passed')).toBe('passed');
    expect(phaseFromStatus('delivered')).toBe('passed');
    expect(phaseFromStatus(null)).toBe('idle');
    expect(phaseFromStatus('unverified')).toBe('idle');
  });
});

describe('isDraftUnconfirmed', () => {
  it('is true only for a planned, not-yet-confirmed plan', () => {
    expect(isDraftUnconfirmed('planned', null)).toBe(true);
    expect(isDraftUnconfirmed('planned', new Date())).toBe(false);
    expect(isDraftUnconfirmed('verifying', null)).toBe(false);
  });
});

describe('itemBehavior', () => {
  it('maps required → gate, optional → auto_improve', () => {
    expect(itemBehavior({ required: true })).toBe('gate');
    expect(itemBehavior({ required: false })).toBe('auto_improve');
  });
});

describe('countResults', () => {
  it('counts passed/failed by status or verdict', () => {
    expect(
      countResults([
        { status: 'passed', verdict: 'passed' } as any,
        { status: 'failed', verdict: 'failed' } as any,
        { status: 'skipped', verdict: null } as any,
      ]),
    ).toEqual({ failed: 1, passed: 1, total: 3 });
  });
});
