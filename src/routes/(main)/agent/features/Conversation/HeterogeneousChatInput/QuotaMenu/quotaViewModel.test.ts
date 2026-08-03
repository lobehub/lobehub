import type { ClaudeCodeQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import type { QuotaReadingRow } from './quotaViewModel';
import {
  buildClaudeSnapshotFromReadings,
  isQuotaStale,
  mergeClaudeSnapshots,
  newestCapturedAt,
} from './quotaViewModel';

const reset = Date.parse('2026-07-21T14:00:00Z');
const sessionReset = Date.parse('2026-07-18T20:50:00Z');
// Fixed "now" inside both windows, so the fixtures stay live regardless of the
// wall clock the suite runs on.
const now = Date.parse('2026-07-18T08:05:00Z');
const capturedAt = Date.parse('2026-07-18T08:00:00Z');

const account = {
  displayName: 'Arvin',
  email: 'lobehubbot@gmail.com',
  externalAccountId: '48bfd5c6',
  planTier: 'max',
  rateLimitTier: 'default_claude_max_20x',
  updatedAt: new Date('2026-07-18T08:01:00Z'),
};

const readings: QuotaReadingRow[] = [
  { capturedAt, limitType: 'session', resetsAt: sessionReset, scopeKey: '', utilization: 43 },
  { capturedAt, limitType: 'weekly_all', resetsAt: reset, scopeKey: '', utilization: 62 },
  {
    capturedAt,
    limitType: 'weekly_scoped',
    resetsAt: reset,
    scopeKey: 'Fable',
    utilization: 100,
  },
];

describe('buildClaudeSnapshotFromReadings', () => {
  it('maps persisted readings to the panel snapshot (session / weekly / Fable scoped)', () => {
    const snap = buildClaudeSnapshotFromReadings(account, readings, now);
    expect(snap.status).toBe('ok');
    expect(snap.session).toEqual({
      resetsAt: sessionReset,
      usedPercent: 43,
      windowMinutes: 300,
    });
    expect(snap.weekly).toEqual({ resetsAt: reset, usedPercent: 62, windowMinutes: 10_080 });
    expect(snap.scopedWeekly).toEqual({
      modelName: 'Fable',
      window: { resetsAt: reset, usedPercent: 100, windowMinutes: 10_080 },
    });
  });

  it('keeps a rolled-over window in the panel as refilled', () => {
    // The 5-hour window rolls over first: after five idle hours the persisted
    // session reading points at a reset that has passed. Dropping the row made
    // the panel show the weekly limit alone, as if the plan had no session
    // limit at all; replaying its 43% would claim spend that has refilled.
    const afterSessionReset = sessionReset + 60_000;
    const snap = buildClaudeSnapshotFromReadings(account, readings, afterSessionReset);

    expect(snap.session).toEqual({ resetsAt: null, usedPercent: 0, windowMinutes: 300 });
    expect(snap.weekly).toMatchObject({ usedPercent: 62 });
    expect(snap.scopedWeekly).toMatchObject({ window: { usedPercent: 100 } });
  });

  it('keeps a limit the provider reports without a reset time', () => {
    // An untouched model-scoped weekly arrives as `resets_at: null`, so it has
    // no window row to be projected into — only the reading carries it.
    const snap = buildClaudeSnapshotFromReadings(
      account,
      [
        {
          capturedAt,
          limitType: 'weekly_scoped',
          resetsAt: null,
          scopeKey: 'Fable',
          utilization: 0,
        },
      ],
      now,
    );

    expect(snap.scopedWeekly).toEqual({
      modelName: 'Fable',
      window: { resetsAt: null, usedPercent: 0, windowMinutes: 10_080 },
    });
  });

  it('carries the account identity for the switcher', () => {
    const snap = buildClaudeSnapshotFromReadings(account, readings, now);
    expect(snap.identity).toMatchObject({
      email: 'lobehubbot@gmail.com',
      externalAccountId: '48bfd5c6',
      planTier: 'max',
    });
  });

  it('has no windows for an account with no readings', () => {
    const snap = buildClaudeSnapshotFromReadings(account, [], now);
    expect(snap.session).toBeNull();
    expect(snap.weekly).toBeNull();
    expect(snap.scopedWeekly).toBeNull();
  });
});

describe('newestCapturedAt', () => {
  it('is the newest reading time, 0 with none', () => {
    expect(newestCapturedAt(readings)).toBe(capturedAt);
    expect(newestCapturedAt([{ ...readings[0], capturedAt: now }, ...readings])).toBe(now);
    expect(newestCapturedAt([])).toBe(0);
  });
});

describe('mergeClaudeSnapshots', () => {
  const live: ClaudeCodeQuotaSnapshot = {
    error: null,
    provider: 'claude-code',
    scopedWeekly: {
      modelName: 'Fable',
      window: { resetsAt: reset, usedPercent: 12, windowMinutes: 10_080 },
    },
    session: { resetsAt: sessionReset, usedPercent: 7, windowMinutes: 300 },
    status: 'ok',
    updatedAt: now,
    weekly: { resetsAt: reset, usedPercent: 9, windowMinutes: 10_080 },
  };

  it('fills the windows the persisted view has no reading for', () => {
    // Only the weekly limit was ever persisted; the panel must still show the
    // session and Fable windows the sample in hand carries.
    const persisted = buildClaudeSnapshotFromReadings(account, [readings[1]], now);
    const merged = mergeClaudeSnapshots(persisted, live, capturedAt)!;

    expect(merged.session).toMatchObject({ usedPercent: 7 });
    expect(merged.scopedWeekly).toMatchObject({ modelName: 'Fable' });
    expect(merged.identity).toMatchObject({ externalAccountId: '48bfd5c6' });
  });

  it('leads with the live sample when it is newer than the persisted readings', () => {
    const persisted = buildClaudeSnapshotFromReadings(account, readings, now);
    const merged = mergeClaudeSnapshots(persisted, live, capturedAt)!;

    expect(merged.weekly).toMatchObject({ usedPercent: 9 });
    expect(merged.session).toMatchObject({ usedPercent: 7 });
  });

  it('leads with the persisted view when another host ingested something newer', () => {
    const persisted = buildClaudeSnapshotFromReadings(account, readings, now);
    const merged = mergeClaudeSnapshots(persisted, live, live.updatedAt + 60_000)!;

    expect(merged.weekly).toMatchObject({ usedPercent: 62 });
    expect(merged.session).toMatchObject({ usedPercent: 43 });
  });

  it('ignores a sample taken from another login', () => {
    const persisted = buildClaudeSnapshotFromReadings(account, readings, now);
    const otherAccount = { ...live, identity: { externalAccountId: 'someone-else' } };

    expect(mergeClaudeSnapshots(persisted, otherAccount, 0)).toBe(persisted);
  });

  it('keeps the persisted view when the live fetch failed', () => {
    const persisted = buildClaudeSnapshotFromReadings(account, readings, now);
    const failed = { ...live, error: 'fetch failed', status: 'error' as const };

    expect(mergeClaudeSnapshots(persisted, failed, capturedAt)).toBe(persisted);
    expect(mergeClaudeSnapshots(persisted, null, capturedAt)).toBe(persisted);
  });

  it('falls back to the live sample when nothing is persisted', () => {
    expect(mergeClaudeSnapshots(null, live)).toBe(live);
    expect(mergeClaudeSnapshots(null, null)).toBeNull();
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
    const deviceClockAhead = [{ ...readings[0], capturedAt: Date.parse('2026-07-19T09:00:00Z') }];
    const snap = buildClaudeSnapshotFromReadings(
      { ...account, updatedAt: new Date('2026-07-18T08:50:00Z') },
      deviceClockAhead,
      now,
    );

    expect(snap.updatedAt).toBe(Date.parse('2026-07-18T08:50:00Z'));
    expect(isQuotaStale(new Date(snap.updatedAt), now, 5 * 60_000)).toBe(true);
  });
});
