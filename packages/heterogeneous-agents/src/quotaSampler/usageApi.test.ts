import { describe, expect, it } from 'vitest';

import { mapClaudeUsageToReadings, parseResetsAt } from './usageApi';

describe('mapClaudeUsageToReadings', () => {
  it('parseResetsAt handles ISO / seconds / millis', () => {
    expect(parseResetsAt('2026-07-12T20:50:00Z')).toBe(Date.parse('2026-07-12T20:50:00Z'));
    expect(parseResetsAt(1_760_000_000)).toBe(1_760_000_000_000); // seconds → ms
    expect(parseResetsAt(1_760_000_000_000)).toBe(1_760_000_000_000); // already ms
    expect(parseResetsAt(null)).toBeNull();
    expect(parseResetsAt('nonsense')).toBeNull();
  });

  it('parseResetsAt accepts an epoch delivered as a string', () => {
    // resets_at is typed `number | string`, so the epoch can arrive quoted.
    expect(parseResetsAt('1760000000')).toBe(1_760_000_000_000);
    expect(parseResetsAt('1760000000000')).toBe(1_760_000_000_000);
    expect(parseResetsAt(' 1760000000 ')).toBe(1_760_000_000_000);
    // a short digit string must not be read as a year by Date.parse
    expect(parseResetsAt('1784')).toBe(1_784_000);
    expect(parseResetsAt('')).toBeNull();
  });

  it('maps the real /api/oauth/usage limits[] shape (session + weekly + Fable scoped)', () => {
    // exactly the shape returned by the live endpoint
    const payload = {
      five_hour: { resets_at: '2026-07-12T20:50:00Z', utilization: 26 },
      limits: [
        {
          group: 'session',
          is_active: false,
          kind: 'session',
          percent: 26,
          resets_at: '2026-07-12T20:50:00Z',
          scope: null,
          severity: 'normal',
        },
        {
          group: 'weekly',
          kind: 'weekly_all',
          percent: 29,
          resets_at: '2026-07-18T14:00:00Z',
          scope: null,
          severity: 'normal',
        },
        {
          group: 'weekly',
          is_active: true,
          kind: 'weekly_scoped',
          percent: 38,
          resets_at: '2026-07-18T14:00:00Z',
          scope: { model: { display_name: 'Fable' } },
          severity: 'normal',
        },
      ],
      seven_day: { resets_at: '2026-07-18T14:00:00Z', utilization: 29 },
    };
    const readings = mapClaudeUsageToReadings(payload, 1000);
    expect(readings).toHaveLength(3);
    expect(readings[0]).toMatchObject({
      capturedAt: 1000,
      limitType: 'session',
      scopeKey: '',
      utilization: 26,
    });
    expect(readings[0].resetsAt).toBe(Date.parse('2026-07-12T20:50:00Z'));
    const fable = readings.find((r) => r.limitType === 'weekly_scoped')!;
    expect(fable.scopeKey).toBe('Fable');
    expect(fable.utilization).toBe(38);
    expect(fable.isActive).toBe(true);
  });

  it('falls back to five_hour/seven_day when limits[] absent', () => {
    const readings = mapClaudeUsageToReadings(
      { five_hour: { resets_at: 1_760_000_000, utilization: 40 } },
      1000,
    );
    expect(readings).toEqual([
      {
        capturedAt: 1000,
        limitType: 'session',
        resetsAt: 1_760_000_000_000,
        scopeKey: '',
        utilization: 40,
      },
    ]);
  });
});
