import { describe, expect, it } from 'vitest';

import {
  calibrateCapacity,
  median,
  theilSenSlope,
  windowsToCalibrationIntervals,
} from './calibration';
import { computeTurnCostUsd, totalTokens } from './cost';
import {
  parseClaudeAccountIdentity,
  parseClaudeCredentialPlan,
  parseCodexAccountIdentity,
} from './identity';
import { selectAccount } from './loadBalancer';
import type { QuotaLimitReading } from './types';
import { CLAUDE_SESSION_WINDOW_SECONDS, windowSecondsForKind } from './types';
import { mapClaudeUsageToReadings, parseResetsAt } from './usageApi';
import { findWindowAt, isWindowContaminated, projectWindows } from './windows';

// ── cost ─────────────────────────────────────────────────────────────────────
describe('computeTurnCostUsd', () => {
  it('prices input/output at model rate', () => {
    // opus: $5/MTok in, $25/MTok out
    const cost = computeTurnCostUsd(
      { input: 1_000_000, output: 1_000_000 },
      { input: 5, output: 25 },
    );
    expect(cost).toBeCloseTo(30, 6);
  });

  it('applies default cache multipliers (read 0.1x, 5m 1.25x, 1h 2x of input)', () => {
    const cost = computeTurnCostUsd(
      { cacheRead: 1_000_000, cacheWrite1h: 1_000_000, cacheWrite5m: 1_000_000 },
      { input: 10, output: 50 },
    );
    // 10*0.1 + 10*1.25 + 10*2 = 1 + 12.5 + 20 = 33.5
    expect(cost).toBeCloseTo(33.5, 6);
  });

  it('honors explicit cache rates over defaults', () => {
    const cost = computeTurnCostUsd(
      { cacheRead: 1_000_000 },
      { cacheRead: 0.3, input: 3, output: 15 },
    );
    expect(cost).toBeCloseTo(0.3, 6);
  });

  it('captures the Fable-vs-Opus price ratio that proved the unit', () => {
    // same token shape, Fable is 2x Opus → cost is 2x
    const usage = { input: 500_000, output: 200_000 };
    const opus = computeTurnCostUsd(usage, { input: 5, output: 25 });
    const fable = computeTurnCostUsd(usage, { input: 10, output: 50 });
    expect(fable / opus).toBeCloseTo(2, 6);
  });

  it('totalTokens sums all classes', () => {
    expect(totalTokens({ cacheRead: 3, input: 1, output: 2 })).toBe(6);
  });
});

// ── identity ─────────────────────────────────────────────────────────────────
describe('identity parsing', () => {
  it('parses Claude ~/.claude.json oauthAccount', () => {
    const id = parseClaudeAccountIdentity(
      JSON.stringify({
        oauthAccount: {
          accountUuid: '687dc4eb-2aad-45fc-92be-402acbe51661',
          displayName: 'Arvin',
          emailAddress: 'a@example.com',
          organizationRateLimitTier: 'default_claude_max_20x',
          organizationType: 'claude_max',
          organizationUuid: 'org-1',
        },
      }),
    );
    expect(id).toEqual({
      displayName: 'Arvin',
      email: 'a@example.com',
      externalAccountId: '687dc4eb-2aad-45fc-92be-402acbe51661',
      organizationId: 'org-1',
      planTier: 'max',
      rateLimitTier: 'default_claude_max_20x',
    });
  });

  it('returns null without an account uuid', () => {
    expect(parseClaudeAccountIdentity('{}')).toBeNull();
    expect(parseClaudeAccountIdentity('not json')).toBeNull();
  });

  it('reads plan hints from the credential blob', () => {
    const plan = parseClaudeCredentialPlan(
      JSON.stringify({
        claudeAiOauth: {
          expiresAt: 123,
          rateLimitTier: 'default_claude_max_20x',
          subscriptionType: 'max',
        },
      }),
    );
    expect(plan).toEqual({
      expiresAt: 123,
      planTier: 'max',
      rateLimitTier: 'default_claude_max_20x',
    });
  });

  it('parses Codex auth.json + id_token claims', () => {
    const claims = {
      'email': 'a@example.com',
      'https://api.openai.com/auth': { chatgpt_account_id: 'acc-x', chatgpt_plan_type: 'pro' },
    };
    const b64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const idToken = `h.${b64}.s`;
    const id = parseCodexAccountIdentity(
      JSON.stringify({ tokens: { account_id: 'acc-x', id_token: idToken } }),
    );
    expect(id).toEqual({ email: 'a@example.com', externalAccountId: 'acc-x', planTier: 'pro' });
  });

  it('returns null for empty codex auth', () => {
    expect(parseCodexAccountIdentity('{}')).toBeNull();
  });
});

// ── windows ──────────────────────────────────────────────────────────────────
describe('windowSecondsForKind', () => {
  it('maps weekly kinds to 7d and everything else to 5h', () => {
    expect(windowSecondsForKind('session')).toBe(CLAUDE_SESSION_WINDOW_SECONDS);
    expect(windowSecondsForKind('weekly_all')).toBe(7 * 24 * 60 * 60);
    expect(windowSecondsForKind('weekly_scoped')).toBe(7 * 24 * 60 * 60);
  });
});

describe('projectWindows', () => {
  const reset = Date.parse('2026-07-12T20:50:00Z');
  const mk = (over: Partial<QuotaLimitReading>): QuotaLimitReading => ({
    capturedAt: reset - 3_600_000,
    limitType: 'session',
    resetsAt: reset,
    scopeKey: '',
    utilization: 10,
    ...over,
  });

  it('derives window start from resetsAt - windowSeconds', () => {
    const [w] = projectWindows([mk({})]);
    expect(w.windowStartAt).toBe(reset - CLAUDE_SESSION_WINDOW_SECONDS * 1000);
    expect(w.resetsAt).toBe(reset);
  });

  it('keeps the peak utilization even when a later sample is lower', () => {
    const [w] = projectWindows([
      mk({ capturedAt: reset - 3_000_000, utilization: 30 }),
      mk({ capturedAt: reset - 2_000_000, utilization: 80 }),
      mk({ capturedAt: reset - 1_000_000, utilization: 82 }),
    ]);
    expect(w.peakUtilization).toBe(82);
    expect(w.lastUtilization).toBe(82);
  });

  it('groups by (kind, scope, resetsAt) and records first 429', () => {
    const windows = projectWindows([
      mk({ capturedAt: reset - 3_000_000, utilization: 40 }),
      mk({ capturedAt: reset - 2_000_000, rateLimited: true, utilization: 100 }),
      mk({ limitType: 'weekly_scoped', scopeKey: 'Fable', utilization: 38 }),
    ]);
    expect(windows).toHaveLength(2);
    const session = windows.find((w) => w.limitType === 'session')!;
    expect(session.rateLimitedAt).toBe(reset - 2_000_000);
    const fable = windows.find((w) => w.scopeKey === 'Fable')!;
    expect(fable.limitType).toBe('weekly_scoped');
  });

  it('ignores readings without a resetsAt', () => {
    expect(projectWindows([mk({ resetsAt: null })])).toHaveLength(0);
  });

  it('findWindowAt locates the containing window', () => {
    const [w] = projectWindows([mk({})]);
    expect(findWindowAt([w], reset - 1000)).toBe(w);
    expect(findWindowAt([w], reset + 1000)).toBeUndefined();
  });
});

describe('isWindowContaminated', () => {
  it('flags a moved meter with no ledger spend', () => {
    expect(isWindowContaminated(40, 0)).toBe(true);
    expect(isWindowContaminated(40, 120)).toBe(false); // we spent → clean
    expect(isWindowContaminated(1, 0)).toBe(false); // barely moved → ignore
  });
});

// ── calibration ──────────────────────────────────────────────────────────────
describe('median & theilSenSlope', () => {
  it('median handles odd/even', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('theil-sen recovers a clean slope and resists an outlier', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 5 },
      { x: 2, y: 10 },
      { x: 3, y: 15 },
      { x: 4, y: 20 },
      { x: 5, y: 500 }, // outlier — minority of pairwise slopes
    ];
    expect(theilSenSlope(pts)).toBeCloseTo(5, 6);
    expect(theilSenSlope([{ x: 1, y: 1 }])).toBeNull();
  });
});

describe('calibrateCapacity', () => {
  it('recovers a known capacity ($500 → $5 per point)', () => {
    const intervals = [
      { deltaCostUsd: 50, deltaUtil: 10 },
      { deltaCostUsd: 40, deltaUtil: 8 },
      { deltaCostUsd: 30, deltaUtil: 6 },
      { deltaCostUsd: 100, deltaUtil: 20 },
    ];
    const r = calibrateCapacity(intervals)!;
    expect(r.capacityUsd).toBeCloseTo(500, 6);
    expect(r.sampleCount).toBe(4);
    expect(r.confidence).toBeGreaterThan(0.3);
    expect(r.method).toBe('ratio-median');
  });

  it('drops sub-threshold intervals (integer-percent quantization guard)', () => {
    const r = calibrateCapacity([
      { deltaCostUsd: 5, deltaUtil: 1 }, // dropped
      { deltaCostUsd: 50, deltaUtil: 10 },
      { deltaCostUsd: 60, deltaUtil: 12 },
    ]);
    expect(r!.sampleCount).toBe(2);
    expect(r!.capacityUsd).toBeCloseTo(500, 0);
  });

  it('returns null with no usable samples', () => {
    expect(calibrateCapacity([{ deltaCostUsd: 1, deltaUtil: 1 }])).toBeNull();
    expect(calibrateCapacity([])).toBeNull();
  });

  it('lower dispersion → higher confidence', () => {
    const tight = calibrateCapacity([
      { deltaCostUsd: 50, deltaUtil: 10 },
      { deltaCostUsd: 50, deltaUtil: 10 },
      { deltaCostUsd: 50, deltaUtil: 10 },
    ])!;
    const noisy = calibrateCapacity([
      { deltaCostUsd: 50, deltaUtil: 10 },
      { deltaCostUsd: 200, deltaUtil: 10 },
      { deltaCostUsd: 10, deltaUtil: 10 },
    ])!;
    expect(tight.confidence).toBeGreaterThan(noisy.confidence);
  });
});

describe('windowsToCalibrationIntervals', () => {
  it('keeps clean windows, drops contaminated / rate-limited / censored ones', () => {
    const intervals = windowsToCalibrationIntervals([
      { observedCostUsd: 142, peakUtilization: 26, rateLimitedAt: null }, // clean ✓
      { contaminated: true, observedCostUsd: 0, peakUtilization: 40, rateLimitedAt: null }, // external usage ✗
      { observedCostUsd: 33, peakUtilization: 100, rateLimitedAt: 123 }, // weekly cut it short ✗
      { observedCostUsd: 0, peakUtilization: 0, rateLimitedAt: null }, // empty ✗
    ]);
    expect(intervals).toEqual([{ deltaCostUsd: 142, deltaUtil: 26 }]);
  });

  it('end-to-end: clean windows calibrate near the real $548 5h capacity', () => {
    // windows around ~$5.5 per utilization point
    const windows = [
      { observedCostUsd: 142, peakUtilization: 26, rateLimitedAt: null },
      { observedCostUsd: 300, peakUtilization: 55, rateLimitedAt: null },
      { observedCostUsd: 210, peakUtilization: 38, rateLimitedAt: null },
      { observedCostUsd: 90, peakUtilization: 16, rateLimitedAt: null },
    ];
    const result = calibrateCapacity(windowsToCalibrationIntervals(windows))!;
    expect(result.capacityUsd).toBeGreaterThan(450);
    expect(result.capacityUsd).toBeLessThan(650);
  });
});

// ── usage API mapping ─────────────────────────────────────────────────────────
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

// ── load balancer ─────────────────────────────────────────────────────────────
describe('selectAccount', () => {
  const base = { enabled: true, priority: 0 };

  it('prefers the account with more weekly headroom (the bottleneck)', () => {
    const pick = selectAccount(
      [
        { ...base, accountId: 'a', sessionUtil: 0, weeklyUtil: 72 },
        { ...base, accountId: 'b', sessionUtil: 90, weeklyUtil: 30 },
      ],
      { now: 0 },
    );
    // b has less session headroom but more WEEKLY headroom → wins
    expect(pick?.accountId).toBe('b');
  });

  it('routes Fable work away from a Fable-exhausted account (screenshot case)', () => {
    // account A: weekly 43% but Fable 100% (已耗尽); account B: weekly 60%, Fable ok
    const accounts = [
      { ...base, accountId: 'A', scopedWeeklyUtil: { Fable: 100 }, weeklyUtil: 57 },
      { ...base, accountId: 'B', scopedWeeklyUtil: { Fable: 20 }, weeklyUtil: 40 },
    ];
    // a Fable task must avoid A even though A's overall weekly is comparable
    expect(selectAccount(accounts, { modelScope: 'Fable', now: 0 })?.accountId).toBe('B');
    // a non-Fable task can still use A (more weekly headroom than... here B has more, so B)
    expect(selectAccount(accounts, { now: 0 })?.accountId).toBe('B');
  });

  it('skips accounts that are exhausted or cooling down after a 429', () => {
    expect(
      selectAccount(
        [
          { ...base, accountId: 'x', weeklyUtil: 100 },
          { ...base, accountId: 'y', rateLimitedUntil: 5000, weeklyUtil: 10 },
        ],
        { now: 1000 },
      ),
    ).toBeNull();
    // once y's cooldown passes it becomes eligible
    expect(
      selectAccount([{ ...base, accountId: 'y', rateLimitedUntil: 5000, weeklyUtil: 10 }], {
        now: 6000,
      })?.accountId,
    ).toBe('y');
  });

  it('honors disabled + priority tie-breaker', () => {
    const pick = selectAccount(
      [
        { ...base, accountId: 'disabled', enabled: false, weeklyUtil: 0 },
        { ...base, accountId: 'p2', priority: 2, weeklyUtil: 50 },
        { ...base, accountId: 'p1', priority: 1, weeklyUtil: 50 },
      ],
      { now: 0 },
    );
    expect(pick?.accountId).toBe('p1');
  });
});
