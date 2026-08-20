import type { ClaudeCodeQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import type { QuotaReadingRow } from './quotaViewModel';
import { buildClaudePanelSnapshot, isQuotaStale, newestCapturedAt } from './quotaViewModel';

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

describe('buildClaudePanelSnapshot — persisted readings', () => {
  it('maps persisted readings to the panel snapshot (session / weekly / Fable scoped)', () => {
    const snap = buildClaudePanelSnapshot(account, readings, null, now);
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
    const snap = buildClaudePanelSnapshot(account, readings, null, afterSessionReset);

    expect(snap.session).toEqual({ resetsAt: null, usedPercent: 0, windowMinutes: 300 });
    expect(snap.weekly).toMatchObject({ usedPercent: 62 });
    expect(snap.scopedWeekly).toMatchObject({ window: { usedPercent: 100 } });
  });

  it('keeps a limit the provider reports without a reset time', () => {
    // An untouched model-scoped weekly arrives as `resets_at: null`, so it has
    // no window row to be projected into — only the reading carries it.
    const snap = buildClaudePanelSnapshot(
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
      null,
      now,
    );

    expect(snap.scopedWeekly).toEqual({
      modelName: 'Fable',
      window: { resetsAt: null, usedPercent: 0, windowMinutes: 10_080 },
    });
  });

  it('carries the account identity for the switcher', () => {
    const snap = buildClaudePanelSnapshot(account, readings, null, now);
    expect(snap.identity).toMatchObject({
      email: 'lobehubbot@gmail.com',
      externalAccountId: '48bfd5c6',
      planTier: 'max',
    });
  });

  it('has no windows for an account with no readings', () => {
    const snap = buildClaudePanelSnapshot(account, [], null, now);
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

describe('buildClaudePanelSnapshot — folding in a live sample', () => {
  const liveReading = (over: Partial<QuotaReadingRow> = {}): QuotaReadingRow => ({
    capturedAt: now,
    limitType: 'session',
    resetsAt: sessionReset,
    scopeKey: '',
    utilization: 7,
    ...over,
  });

  const live: ClaudeCodeQuotaSnapshot = {
    error: null,
    identity: { externalAccountId: '48bfd5c6' },
    provider: 'claude-code',
    readings: [
      liveReading(),
      liveReading({ limitType: 'weekly_all', resetsAt: reset, utilization: 9 }),
    ],
    scopedWeekly: {
      modelName: 'Fable',
      window: { resetsAt: reset, usedPercent: 12, windowMinutes: 10_080 },
    },
    session: { resetsAt: sessionReset, usedPercent: 7, windowMinutes: 300 },
    status: 'ok',
    updatedAt: now,
    weekly: { resetsAt: reset, usedPercent: 9, windowMinutes: 10_080 },
  };

  it('takes the newest reading per limit, not the newest snapshot', () => {
    // Buckets can be persisted at different times (one device ingested the
    // session at 08:00 while the weekly last landed at 06:00). Comparing whole
    // snapshots would let the fresher session bucket suppress a live weekly
    // that is genuinely newer than the persisted one.
    const persisted = [
      readings[0], // session, captured 08:00 — newer than the live sample below
      { ...readings[1], capturedAt: Date.parse('2026-07-18T06:00:00Z') }, // weekly, stale
    ];
    const olderLive = { ...live, updatedAt: Date.parse('2026-07-18T07:00:00Z') };
    const snap = buildClaudePanelSnapshot(
      account,
      persisted,
      {
        ...olderLive,
        readings: [
          liveReading({ capturedAt: Date.parse('2026-07-18T07:00:00Z') }),
          liveReading({
            capturedAt: Date.parse('2026-07-18T07:00:00Z'),
            limitType: 'weekly_all',
            resetsAt: reset,
            utilization: 9,
          }),
        ],
      },
      now,
    );

    expect(snap.session).toMatchObject({ usedPercent: 43 }); // persisted 08:00 wins
    expect(snap.weekly).toMatchObject({ usedPercent: 9 }); // live 07:00 beats persisted 06:00
  });

  it('fills a limit the account has no reading for from the sample', () => {
    const snap = buildClaudePanelSnapshot(account, [readings[1]], live, now);

    expect(snap.session).toMatchObject({ usedPercent: 7 });
    expect(snap.scopedWeekly).toMatchObject({ modelName: 'Fable' });
    expect(snap.identity).toMatchObject({ externalAccountId: '48bfd5c6' });
  });

  it('refuses a sample it cannot attribute to this account', () => {
    // `~/.claude.json` may carry no oauthAccount while the quota comes from the
    // keychain. With several logins on the machine the CLI's current one is not
    // necessarily this account, so an unidentified sample must not be painted
    // under this account's name — not even to fill an empty window.
    const unidentified = { ...live, identity: undefined };
    const otherAccount = { ...live, identity: { externalAccountId: 'someone-else' } };

    expect(buildClaudePanelSnapshot(account, [readings[1]], unidentified, now).session).toBeNull();
    expect(buildClaudePanelSnapshot(account, [readings[1]], otherAccount, now).session).toBeNull();
    // An account we cannot name has nothing to be confused with.
    const anonymous = { ...account, externalAccountId: null };
    expect(
      buildClaudePanelSnapshot(anonymous, [readings[1]], unidentified, now).session,
    ).toMatchObject({ usedPercent: 7 });
  });

  it('reports the sample time once a live sample has been consulted', () => {
    // Otherwise the header says "3 分钟前更新" over just-fetched numbers and
    // every staleness gate immediately refetches the quota we already have.
    const stale = { ...account, updatedAt: new Date('2026-07-18T07:00:00Z') };

    expect(buildClaudePanelSnapshot(stale, readings, live, now).updatedAt).toBe(live.updatedAt);
    expect(buildClaudePanelSnapshot(stale, readings, null, now).updatedAt).toBe(
      Date.parse('2026-07-18T07:00:00Z'),
    );
  });

  it('keeps the persisted view when the live fetch failed', () => {
    const failed = { ...live, error: 'fetch failed', status: 'error' as const };

    expect(buildClaudePanelSnapshot(account, readings, failed, now).session).toMatchObject({
      usedPercent: 43,
    });
    expect(buildClaudePanelSnapshot(account, readings, null, now).session).toMatchObject({
      usedPercent: 43,
    });
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
    const snap = buildClaudePanelSnapshot(
      { ...account, updatedAt: new Date('2026-07-18T08:50:00Z') },
      deviceClockAhead,
      null,
      now,
    );

    expect(snap.updatedAt).toBe(Date.parse('2026-07-18T08:50:00Z'));
    expect(isQuotaStale(new Date(snap.updatedAt), now, 5 * 60_000)).toBe(true);
  });
});
