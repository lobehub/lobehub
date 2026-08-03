import { describe, expect, it } from 'vitest';

import { computePeriodWindow } from './periodBoundaries';

describe('computePeriodWindow (UTC OpenRouter boundaries)', () => {
  it('daily resets at next UTC midnight', () => {
    const now = new Date('2026-08-03T15:30:00.000Z');
    const w = computePeriodWindow('daily', now);
    expect(w.start.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    expect(w.nextRenewalAt.toISOString()).toBe('2026-08-04T00:00:00.000Z');
  });

  it('weekly is Monday–Sunday UTC', () => {
    // Wednesday
    const now = new Date('2026-08-05T12:00:00.000Z');
    const w = computePeriodWindow('weekly', now);
    expect(w.start.toISOString()).toBe('2026-08-03T00:00:00.000Z'); // Monday
    expect(w.end.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('monthly is first of month UTC', () => {
    const now = new Date('2026-08-15T01:00:00.000Z');
    const w = computePeriodWindow('monthly', now);
    expect(w.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('total has no practical renewal', () => {
    const now = new Date('2026-08-03T00:00:00.000Z');
    const w = computePeriodWindow('total', now);
    expect(w.nextRenewalAt.getUTCFullYear()).toBe(9999);
  });
});
