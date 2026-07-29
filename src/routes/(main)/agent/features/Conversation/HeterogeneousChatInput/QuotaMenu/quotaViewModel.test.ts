import { describe, expect, it } from 'vitest';

import type { QuotaWindowRow } from './quotaViewModel';
import { buildClaudeSnapshotFromWindows, isQuotaStale } from './quotaViewModel';

const reset = new Date('2026-07-21T14:00:00Z');
const sessionReset = new Date('2026-07-18T20:50:00Z');

const account = {
  displayName: 'Arvin',
  email: 'lobehubbot@gmail.com',
  externalAccountId: '48bfd5c6',
  planTier: 'max',
  rateLimitTier: 'default_claude_max_20x',
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
    const snap = buildClaudeSnapshotFromWindows(account, windows);
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

  it('carries the account identity for the switcher', () => {
    const snap = buildClaudeSnapshotFromWindows(account, windows);
    expect(snap.identity).toMatchObject({
      email: 'lobehubbot@gmail.com',
      externalAccountId: '48bfd5c6',
      planTier: 'max',
    });
  });

  it('prefers lastUtilization over peak and clamps to 0..100', () => {
    const snap = buildClaudeSnapshotFromWindows(account, [
      {
        lastUtilization: null,
        limitType: 'session',
        peakUtilization: 150,
        resetsAt: reset,
        scopeKey: '',
        windowSeconds: 18_000,
      },
    ]);
    expect(snap.session?.usedPercent).toBe(100); // clamped; falls back to peak
  });

  it('tolerates string dates and missing windows', () => {
    const snap = buildClaudeSnapshotFromWindows(account, [
      {
        lastSeenAt: '2026-07-18T08:00:00Z',
        lastUtilization: 20,
        limitType: 'session',
        peakUtilization: 20,
        resetsAt: '2026-07-18T20:50:00Z',
        scopeKey: '',
        windowSeconds: 18_000,
      },
    ]);
    expect(snap.session?.usedPercent).toBe(20);
    expect(snap.session?.resetsAt).toBe(Date.parse('2026-07-18T20:50:00Z'));
    expect(snap.weekly).toBeNull();
    expect(snap.scopedWeekly).toBeNull();
  });
});

describe('isQuotaStale', () => {
  const now = Date.parse('2026-07-18T09:00:00Z');
  const fresh: QuotaWindowRow = {
    lastSeenAt: new Date('2026-07-18T08:57:00Z'),
    lastUtilization: 10,
    limitType: 'session',
    peakUtilization: 10,
    resetsAt: reset,
    scopeKey: '',
    windowSeconds: 18_000,
  };

  it('is stale with no windows', () => {
    expect(isQuotaStale([], now, 5 * 60_000)).toBe(true);
  });

  it('is fresh when newest reading is within maxAge', () => {
    expect(isQuotaStale([fresh], now, 5 * 60_000)).toBe(false);
  });

  it('is stale when newest reading is older than maxAge', () => {
    expect(
      isQuotaStale([{ ...fresh, lastSeenAt: new Date('2026-07-18T08:50:00Z') }], now, 5 * 60_000),
    ).toBe(true);
  });
});
