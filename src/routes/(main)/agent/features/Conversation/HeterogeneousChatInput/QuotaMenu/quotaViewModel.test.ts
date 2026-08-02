import { describe, expect, it } from 'vitest';

import type { QuotaWindowRow } from './quotaViewModel';
import { buildClaudeSnapshotFromWindows, isQuotaStale } from './quotaViewModel';

const reset = new Date('2026-07-21T14:00:00Z');
const sessionReset = new Date('2026-07-18T20:50:00Z');
// Fixed "now" inside both windows, so the fixtures stay live regardless of the
// wall clock the suite runs on (an expired window is intentionally dropped).
const now = new Date('2026-07-18T08:05:00Z').getTime();

const account = {
  displayName: 'Arvin',
  email: 'lobehubbot@gmail.com',
  externalAccountId: '48bfd5c6',
  planTier: 'max',
  rateLimitTier: 'default_claude_max_20x',
  updatedAt: new Date('2026-07-18T08:01:00Z'),
};

const windows: QuotaWindowRow[] = [
  {
    lastSeenAt: new Date('2026-07-18T08:00:00Z'),
    lastUtilization: 43,
    limitType: 'session',
    peakUtilization: 61,
    resetsAt: sessionReset,
    scopeKey: '',
    windowSeconds: 18_000,
  },
  {
    lastSeenAt: new Date('2026-07-18T08:00:00Z'),
    lastUtilization: 62,
    limitType: 'weekly_all',
    peakUtilization: 64,
    resetsAt: reset,
    scopeKey: '',
    windowSeconds: 604_800,
  },
  {
    lastSeenAt: new Date('2026-07-18T08:00:00Z'),
    lastUtilization: 100,
    limitType: 'weekly_scoped',
    peakUtilization: 100,
    resetsAt: reset,
    scopeKey: 'Fable',
    windowSeconds: 604_800,
  },
];

describe('buildClaudeSnapshotFromWindows', () => {
  it('maps DB windows to the panel snapshot (session / weekly / Fable scoped)', () => {
    const snap = buildClaudeSnapshotFromWindows(account, windows, now);
    expect(snap.status).toBe('ok');
    expect(snap.session).toEqual({
      resetsAt: sessionReset.getTime(),
      usedPercent: 43,
      windowMinutes: 300,
    });
    expect(snap.weekly).toEqual({
      resetsAt: reset.getTime(),
      usedPercent: 62,
      windowMinutes: 10_080,
    });
    expect(snap.scopedWeekly).toEqual({
      modelName: 'Fable',
      window: { resetsAt: reset.getTime(), usedPercent: 100, windowMinutes: 10_080 },
    });
  });

  it('drops windows whose reset already passed instead of showing them as spent', () => {
    // A device that has been offline since yesterday leaves windows recorded at
    // 100% utilization whose reset has since elapsed. Rendering those paints an
    // exhausted "0% left" badge over a quota that actually refilled.
    const afterReset = reset.getTime() + 60_000;
    const snap = buildClaudeSnapshotFromWindows(account, windows, afterReset);

    expect(snap.session).toBeNull();
    expect(snap.weekly).toBeNull();
    expect(snap.scopedWeekly).toBeNull();
  });

  it('keeps a window with no recorded reset time', () => {
    const snap = buildClaudeSnapshotFromWindows(
      account,
      [
        {
          lastUtilization: 30,
          limitType: 'session',
          peakUtilization: 30,
          resetsAt: null,
          scopeKey: '',
          windowSeconds: 18_000,
        },
      ],
      Date.parse('2030-01-01T00:00:00Z'),
    );

    expect(snap.session?.usedPercent).toBe(30);
  });

  it('carries the account identity for the switcher', () => {
    const snap = buildClaudeSnapshotFromWindows(account, windows, now);
    expect(snap.identity).toMatchObject({
      email: 'lobehubbot@gmail.com',
      externalAccountId: '48bfd5c6',
      planTier: 'max',
    });
  });

  it('prefers lastUtilization over peak and clamps to 0..100', () => {
    const snap = buildClaudeSnapshotFromWindows(
      account,
      [
        {
          lastUtilization: null,
          limitType: 'session',
          peakUtilization: 150,
          resetsAt: reset,
          scopeKey: '',
          windowSeconds: 18_000,
        },
      ],
      now,
    );
    expect(snap.session?.usedPercent).toBe(100); // clamped; falls back to peak
  });

  it('tolerates string dates and missing windows', () => {
    const snap = buildClaudeSnapshotFromWindows(
      account,
      [
        {
          lastSeenAt: '2026-07-18T08:00:00Z',
          lastUtilization: 20,
          limitType: 'session',
          peakUtilization: 20,
          resetsAt: '2026-07-18T20:50:00Z',
          scopeKey: '',
          windowSeconds: 18_000,
        },
      ],
      now,
    );
    expect(snap.session?.usedPercent).toBe(20);
    expect(snap.session?.resetsAt).toBe(Date.parse('2026-07-18T20:50:00Z'));
    expect(snap.weekly).toBeNull();
    expect(snap.scopedWeekly).toBeNull();
  });
});

describe('isQuotaStale', () => {
  const now = Date.parse('2026-07-18T09:00:00Z');

  it('is stale with no receipt time', () => {
    expect(isQuotaStale(undefined, now, 5 * 60_000)).toBe(true);
  });

  it('is fresh when the server receipt is within maxAge', () => {
    expect(isQuotaStale(new Date('2026-07-18T08:57:00Z'), now, 5 * 60_000)).toBe(false);
  });

  it('is stale when the server receipt is older than maxAge', () => {
    expect(isQuotaStale(new Date('2026-07-18T08:50:00Z'), now, 5 * 60_000)).toBe(true);
  });

  it('ignores device clock skew when building display freshness', () => {
    const deviceClockAhead = [{ ...windows[0], lastSeenAt: new Date('2026-07-19T09:00:00Z') }];
    const snap = buildClaudeSnapshotFromWindows(
      { ...account, updatedAt: new Date('2026-07-18T08:50:00Z') },
      deviceClockAhead,
      now,
    );

    expect(snap.updatedAt).toBe(Date.parse('2026-07-18T08:50:00Z'));
    expect(isQuotaStale(new Date(snap.updatedAt), now, 5 * 60_000)).toBe(true);
  });
});
